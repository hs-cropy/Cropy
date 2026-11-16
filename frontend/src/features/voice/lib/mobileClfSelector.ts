/**
 * 휴대폰(iPhone·안드로이드) 기기 안 기능 선택기 `mobile_clf` (#167).
 *
 * KoELECTRA-small 분류기(int8 ONNX 13.9MB)로 Qwen과 같은 호출 문자열 `<hs_N>(인자=값)<hs_end>`를 만든다.
 * 측정 페이지 `ml/qwen/onnx_web/mobile_test/clf.html`의 추론을 앱으로 옮겼다.
 *
 * 모델 파일은 오프라인 화면이 받아 둔 묶음(#166)을 쓴다.
 *   IndexedDB `cropy-on-device` / `assets` / `fn:mobile_clf` 에 묶음 정보(base_url, files)가 있고,
 *   Cache Storage `transformers-cache` 에 파일 주소를 키로 파일이 있다.
 * 받아 두지 않았거나 파일이 빠졌으면 isReady()가 false라 서버 선택기로 간다.
 */
import { fetchDiagnosisDetail } from "@/lib/api";
import type { DiagnoseResponse } from "@/types/diagnosis";
import type { FunctionSelector, SelectorScreen } from "./functionSelector";
import { compactContext, contextJson, type CompactContext } from "./voiceContext";
import { WordPieceTokenizer } from "./wordpiece";

export const FUNCTION_CACHE = "transformers-cache";
const DB_NAME = "cropy-on-device";
const MAX_LENGTH = 256; // 학습과 같다
const REQUIRED = ["model_int8.onnx", "tokenizer.json", "labels.json"];

interface BundleFile { name: string; bytes: number; sha256: string }
export interface BundleRecord { version: string; base_url: string; files: BundleFile[] }
export interface ClfLabels {
  functions: string[];
  heads: Array<{ function: string; argument: string; values: string[] }>;
  /** 'clf_v2'(11차~)면 화면 상태를 clfContext로 바꿔 넣는다. 없으면 받은 그대로 */
  context_format?: string;
}

// 학습(ml/qwen/build_classifier_notebook.py)·서버(selector/server.py)와 같은 키 이름
const CLF_KEYS: Record<string, string> = {
  ui_stage: "단계", selected_crop: "선택작물", predicted_crop: "예측작물", crop_mismatch: "작물불일치",
  prediction_mode: "방식", category: "분류", disease_name: "병명", confidence: "점수", top_predictions: "후보",
  severity: "심각도", decision_status: "판정", save_status: "저장", recapture: "재촬영", pesticides: "농약",
  selected_usage_id: "선택제품", pending_target: "되물음", name: "이름", region: "부위",
};

const renameKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(renameKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [CLF_KEYS[k] ?? k, renameKeys(v)]));
  }
  return value;
};

/** 분류기에 넣는 화면 상태. 'clf_v2'는 키를 짧은 한국어로, 농약 목록은 개수로 바꾼다 (받은 객체는 그대로 둔다) */
export function clfContext(context: CompactContext, format?: string): CompactContext {
  if (format !== "clf_v2") return context;
  const copy: CompactContext = { ...context };
  if (Array.isArray(copy.pesticides)) copy.pesticides = copy.pesticides.length;
  return renameKeys(copy) as CompactContext;
}

/** 오프라인 화면(app.mjs)과 같은 DB를 연다. 처음 만드는 경우에도 같은 저장소를 만들어 오프라인 화면을 깨지 않는다 */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("assets")) db.createObjectStore("assets");
      if (!db.objectStoreNames.contains("records")) db.createObjectStore("records", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("blocked"));
  });
}

/** 오프라인 화면이 다 받은 뒤 적어 둔 묶음 정보 (`fn:<kind>`). 없으면 null */
export async function readBundleRecord(kind = "mobile_clf"): Promise<BundleRecord | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("assets", "readonly").objectStore("assets").get(`fn:${kind}`);
      request.onsuccess = () => resolve((request.result as BundleRecord | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export const bundleFileUrl = (record: BundleRecord, name: string, origin = location.origin) =>
  new URL(record.base_url.replace(/\/$/, "") + "/" + name, origin).href;

async function cachedBytes(cache: Cache, record: BundleRecord, name: string): Promise<ArrayBuffer> {
  const hit = await cache.match(bundleFileUrl(record, name));
  if (!hit) throw new Error(`${name}이 기기에 없어요`);
  return hit.arrayBuffer();
}

const argmax = (values: ArrayLike<number>) => {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
  return best;
};

/** 분류기 출력(기능 로짓 + 기능별 인자 로짓)을 호출 문자열로 조립한다. 값은 1부터 센다 */
export function assembleCall(labels: ClfLabels, outputs: Record<string, ArrayLike<number>>): string {
  const index = argmax(outputs.fn_logits);
  const fn = labels.functions[index];
  const args = labels.heads
    .filter((head) => head.function === fn)
    .map((head) => `${head.argument}=${argmax(outputs[`${head.function}.${head.argument}`]) + 1}`);
  return `<hs_${index}>(${args.join(", ")})<hs_end>`;
}

type Ort = typeof import("onnxruntime-web/wasm");
interface Loaded { version: string; ort: Ort; session: import("onnxruntime-web/wasm").InferenceSession; tokenizer: WordPieceTokenizer; labels: ClfLabels }
let loading: Promise<Loaded> | null = null;

async function load(record: BundleRecord): Promise<Loaded> {
  const cache = await caches.open(FUNCTION_CACHE);
  const [model, tokenizerText, labelsText] = await Promise.all([
    cachedBytes(cache, record, "model_int8.onnx"),
    cachedBytes(cache, record, "tokenizer.json").then((b) => new TextDecoder().decode(b)),
    cachedBytes(cache, record, "labels.json").then((b) => new TextDecoder().decode(b)),
  ]);
  const ort = await import("onnxruntime-web/wasm");
  // 빌드 때 public/offline-runtime 에 복사한 런타임을 쓴다 (오프라인 화면과 같은 파일, 외부 CDN 없음)
  ort.env.wasm.wasmPaths = "/offline-runtime/";
  ort.env.wasm.numThreads = 1;
  const session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  return { version: record.version, ort, session, tokenizer: new WordPieceTokenizer(JSON.parse(tokenizerText)), labels: JSON.parse(labelsText) };
}

async function loaded(): Promise<Loaded> {
  const record = await readBundleRecord();
  if (!record) throw new Error("휴대폰 기능 선택 모델을 받지 않았어요");
  if (loading) {
    const current = await loading.catch(() => null);
    if (current && current.version === record.version) return current;
  }
  loading = load(record);
  return loading;
}

export async function runClassifier(utterance: string, context: CompactContext): Promise<string> {
  const { ort, session, tokenizer, labels } = await loaded();
  const enc = tokenizer.encodePair(utterance, contextJson(clfContext(context, labels.context_format)), MAX_LENGTH);
  const n = enc.inputIds.length;
  const tensors: Record<string, number[]> = { input_ids: enc.inputIds, attention_mask: enc.attentionMask, token_type_ids: enc.typeIds };
  const feeds: Record<string, import("onnxruntime-web/wasm").Tensor> = {};
  for (const name of session.inputNames) {
    const values = tensors[name];
    if (!values) throw new Error(`분류기 입력 ${name}을 만들 수 없어요`);
    feeds[name] = new ort.Tensor("int64", BigInt64Array.from(values, (v) => BigInt(v)), [1, n]);
  }
  const out = await session.run(feeds);
  const logits: Record<string, ArrayLike<number>> = {};
  for (const [name, tensor] of Object.entries(out)) logits[name] = tensor.data as Float32Array;
  return assembleCall(labels, logits);
}

async function screenContext(screen: SelectorScreen, signal?: AbortSignal): Promise<CompactContext> {
  let diagnosis: DiagnoseResponse | null = null;
  if (screen.diagnosisId) diagnosis = await fetchDiagnosisDetail(screen.diagnosisId, signal);
  return compactContext(diagnosis, screen.uiStage);
}

export const mobileClfSelector: FunctionSelector = {
  kind: "mobile_clf",
  async isReady() {
    if (typeof caches === "undefined") return false;
    const record = await readBundleRecord();
    if (!record || !REQUIRED.every((name) => record.files.some((f) => f.name === name))) return false;
    const cache = await caches.open(FUNCTION_CACHE);
    for (const name of REQUIRED) if (!(await cache.match(bundleFileUrl(record, name)))) return false;
    return true;
  },
  async select(utterance, screen, signal) {
    const context = await screenContext(screen, signal);
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    return { function_call: await runClassifier(utterance, context), context };
  },
};

/** 테스트용: 불러 둔 세션을 비운다 */
export function resetMobileClf(): void {
  loading = null;
}
