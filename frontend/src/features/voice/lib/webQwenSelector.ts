/**
 * WebGPU PC 브라우저 기기 안 기능 선택기 `web_qwen` (#168).
 *
 * Qwen3.5-2B 6 run 평균 모델의 q4f16 ONNX 묶음(1.34GB)을 transformers.js(WebGPU)로 돌려
 * 서버와 같은 호출 문자열 `<hs_N>(인자=값)<hs_end>`를 만든다. 측정 페이지 `ml/qwen/onnx_web/mobile_test/index.html`의
 * 프롬프트·프롬프트 상태(prefix)·나눠 처리하기·생성 설정을 그대로 옮겼다.
 *
 * 모델 파일은 오프라인 화면이 받아 둔 묶음(#166)을 쓴다.
 *   IndexedDB `cropy-on-device`/`assets`/`fn:web_qwen` 에 묶음 정보, Cache Storage `transformers-cache` 에 파일.
 *   transformers.js는 같은 캐시를 `remoteHost + 모델 + '/' + 파일` 키로 읽으므로 네트워크 없이 불러온다.
 */
import { fetchDiagnosisDetail } from "@/lib/api";
import type { DiagnoseResponse } from "@/types/diagnosis";
import type { FunctionSelector, SelectorScreen } from "./functionSelector";
import { FUNCTION_CACHE, readBundleRecord, type BundleRecord } from "./mobileClfSelector";
import { compactContext, contextJson, type CompactContext } from "./voiceContext";

const KIND = "web_qwen";
const DTYPE = "q4f16";
/** 프롬프트를 이만큼씩 나눠 처리한다 (같은 출력, 낮은 최대 메모리) */
const CHUNK = 128;
/** 측정 페이지와 같은 종료 토큰: cropy_prompt.json의 <hs_end>와 Qwen <|im_end|> */
const IM_END_ID = 248046;
const REQUIRED = ["cropy_prompt.json", "config.json", "tokenizer.json"];

interface CropyPrompt { system_prompt: string; new_tokens: Record<string, number>; stop_token: string }
interface PrefixMeta { prefix_len: number; prefix_ids: number[]; tensors: Record<string, { dtype: string; offset: number; bytes: number; shape: number[] }> }

/** 학습 때와 같은 사용자 메시지와 Qwen 대화 틀 (생각 끔) */
export function buildPrompt(systemPrompt: string, utterance: string, context: CompactContext): string {
  const user = '{"utterance":' + JSON.stringify(utterance) + ',"context":' + contextJson(context) + "}";
  return "<|im_start|>system\n" + systemPrompt + "<|im_end|>\n<|im_start|>user\n" + user + "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n";
}

/** 생성 결과에서 호출 문자열만 남긴다 */
export function cleanOutput(text: string): string {
  return text.replace("<|im_end|>", "").trim();
}

const modelId = (record: BundleRecord) => record.base_url.replace(/\/$/, "").split("/").pop()!;
const remoteHost = (record: BundleRecord, origin = location.origin) =>
  new URL(record.base_url.replace(/\/$/, "").replace(/[^/]+$/, ""), origin).href;

async function cachedJson<T>(cache: Cache, record: BundleRecord, name: string): Promise<T | null> {
  const hit = await cache.match(remoteHost(record) + modelId(record) + "/" + name);
  return hit ? ((await hit.json()) as T) : null;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- transformers.js 타입을 앱 전체로 끌어들이지 않는다 */
interface Loaded { version: string; hf: any; tok: any; model: any; prompt: CropyPrompt; prefix: { meta: PrefixMeta; buf: ArrayBuffer } | null }
let loading: Promise<Loaded> | null = null;

async function load(record: BundleRecord): Promise<Loaded> {
  const hf: any = await import("@huggingface/transformers");
  hf.env.allowLocalModels = false;
  hf.env.allowRemoteModels = true; // 캐시에 없으면 같은 서버 주소에서 받는다
  hf.env.useBrowserCache = true;
  hf.env.remoteHost = remoteHost(record);
  hf.env.remotePathTemplate = "{model}/";
  const id = modelId(record);
  const cache = await caches.open(FUNCTION_CACHE);
  const prompt = await cachedJson<CropyPrompt>(cache, record, "cropy_prompt.json");
  if (!prompt) throw new Error("cropy_prompt.json이 기기에 없어요");
  const tok = await hf.AutoTokenizer.from_pretrained(id);
  const model = await hf.AutoModelForCausalLM.from_pretrained(id, { dtype: DTYPE, device: "webgpu" });
  // 고정 시스템 프롬프트 뒤의 디코더 상태(PC에서 미리 계산, prefix_state.py). 있으면 질문마다 ~110토큰만 처리한다
  let prefix: Loaded["prefix"] = null;
  const meta = await cachedJson<PrefixMeta>(cache, record, `prefix_${DTYPE}.json`);
  const bin = await cache.match(remoteHost(record) + id + `/prefix_${DTYPE}.bin`);
  if (meta && bin) prefix = { meta, buf: await bin.arrayBuffer() };
  return { version: record.version, hf, tok, model, prompt, prefix };
}

async function loaded(): Promise<Loaded> {
  const record = await readBundleRecord(KIND);
  if (!record) throw new Error("PC 기능 선택 모델을 받지 않았어요");
  if (loading) {
    const current = await loading.catch(() => null);
    if (current && current.version === record.version) return current;
  }
  loading = load(record);
  return loading;
}

export async function runWebQwen(utterance: string, context: CompactContext): Promise<string> {
  const { hf, tok, model, prompt, prefix } = await loaded();
  const enc = tok(buildPrompt(prompt.system_prompt, utterance, context), { add_special_tokens: false });
  const n: number = enc.input_ids.dims[1];
  const ids: ArrayLike<bigint | number> = enc.input_ids.data;
  const endId = prompt.new_tokens[prompt.stop_token];
  // return_dict_in_generate: 마지막 캐시를 돌려받아 직접 해제한다. 안 하면 질문마다 GPU 버퍼가 새어 나간다
  const genCfg = { max_new_tokens: 16, do_sample: false, eos_token_id: [endId, IM_END_ID], return_dict_in_generate: true };
  let cache: any = null;
  let start = 0;
  if (prefix && prefix.meta.prefix_len < n && prefix.meta.prefix_ids.every((v, i) => BigInt(v) === BigInt(ids[i]))) {
    const pkv: Record<string, any> = {};
    for (const [k, t] of Object.entries(prefix.meta.tensors)) {
      pkv[k] = t.dtype === "float16"
        ? new hf.Tensor("float16", new Uint16Array(prefix.buf, t.offset, t.bytes / 2), t.shape)
        : new hf.Tensor("float32", new Float32Array(prefix.buf, t.offset, t.bytes / 4), t.shape);
    }
    cache = new hf.DynamicCache(pkv);
    start = prefix.meta.prefix_len;
  }
  let out: any;
  try {
    if (start > 0 || n > CHUNK) {
      // ids[start : n-1]을 나눠 캐시에 넣고 마지막 토큰부터 generate()가 이어 간다 (측정 페이지에서 한 번에 처리한 것과 같은 출력 확인)
      const present2past = (k: string) => k.replace("present_conv", "past_conv").replace("present_recurrent", "past_recurrent").replace("present", "past_key_values");
      for (let a = start; a < n - 1; a += CHUNK) {
        const b = Math.min(n - 1, a + CHUNK);
        const len = b - a;
        const pos = new BigInt64Array(3 * len);
        for (let r = 0; r < 3; r++) for (let i = 0; i < len; i++) pos[r * len + i] = BigInt(a + i);
        const res = await model.forward({
          input_ids: new hf.Tensor("int64", BigInt64Array.from(Array.from(ids).slice(a, b), (v) => BigInt(v)), [1, len]),
          attention_mask: new hf.Tensor("int64", new BigInt64Array(b).fill(BigInt(1)), [1, b]),
          position_ids: new hf.Tensor("int64", pos, [3, 1, len]),
          num_logits_to_keep: new hf.Tensor("int64", [BigInt(1)], []),
          past_key_values: cache,
        });
        const pkv: Record<string, any> = {};
        for (const k in res) {
          if (k.startsWith("present")) pkv[present2past(k)] = res[k];
          else if (res[k]?.location === "gpu-buffer") res[k].dispose();
        }
        if (cache) cache.update(pkv); else cache = new hf.DynamicCache(pkv);
      }
      out = await model.generate({ input_ids: enc.input_ids, attention_mask: enc.attention_mask, past_key_values: cache, ...genCfg });
    } else {
      out = await model.generate({ ...enc, ...genCfg });
    }
  } finally {
    if (out?.past_key_values) await out.past_key_values.dispose();
    if (cache) await cache.dispose();
  }
  const generated = Array.from(out.sequences.data as ArrayLike<bigint>, Number).slice(n);
  return cleanOutput(tok.decode(generated, { skip_special_tokens: false }));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function screenContext(screen: SelectorScreen, signal?: AbortSignal): Promise<CompactContext> {
  let diagnosis: DiagnoseResponse | null = null;
  if (screen.diagnosisId) diagnosis = await fetchDiagnosisDetail(screen.diagnosisId, signal);
  return compactContext(diagnosis, screen.uiStage);
}

export const webQwenSelector: FunctionSelector = {
  kind: KIND,
  async isReady() {
    if (typeof caches === "undefined" || !("gpu" in navigator)) return false;
    const record = await readBundleRecord(KIND);
    if (!record || !REQUIRED.every((name) => record.files.some((f) => f.name === name))) return false;
    const cache = await caches.open(FUNCTION_CACHE);
    for (const file of record.files) {
      if (!(await cache.match(remoteHost(record) + modelId(record) + "/" + file.name))) return false;
    }
    return true;
  },
  async select(utterance, screen, signal) {
    const context = await screenContext(screen, signal);
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    return { function_call: await runWebQwen(utterance, context), context };
  },
};

/** 테스트용 */
export function resetWebQwen(): void {
  loading = null;
}
