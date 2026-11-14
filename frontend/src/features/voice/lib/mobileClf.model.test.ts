// @vitest-environment node
/**
 * 실제 분류기 파일로 하는 확인. 모델 파일은 저장소에 없으므로 환경 변수가 있을 때만 돈다.
 *   CROPY_CLF_DIR  분류기 폴더 (model_int8.onnx, tokenizer.json, labels.json — ml/qwen/MODEL_ASSETS.md 의 mobile_clf)
 *   CROPY_CLF_REF  Python(tokenizers·onnxruntime)으로 만든 validation 기준 파일 (행마다 utterance, context, ctx, ids, type_ids, output, expected=정답)
 * 예: CROPY_CLF_DIR=C:/cropy/eval/clf8 CROPY_CLF_REF=.../ref.json npx vitest run src/features/voice/lib/mobileClf.model.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assembleCall, type ClfLabels } from "./mobileClfSelector";
import { contextJson } from "./voiceContext";
import { WordPieceTokenizer } from "./wordpiece";

const dir = process.env.CROPY_CLF_DIR;
const refPath = process.env.CROPY_CLF_REF;

interface RefRow { utterance: string; context: Record<string, unknown>; ctx: string; ids: number[]; type_ids: number[]; output: string; expected?: string }

describe.skipIf(!dir || !refPath)("휴대폰 분류기 실제 파일", () => {
  const rows = (): RefRow[] => JSON.parse(readFileSync(refPath!, "utf-8"));
  const tokenizer = () => new WordPieceTokenizer(JSON.parse(readFileSync(join(dir!, "tokenizer.json"), "utf-8")));

  it("화면 상태 직렬화와 토큰 id가 Python과 모두 같다", () => {
    const tok = tokenizer();
    const mismatches: string[] = [];
    for (const row of rows()) {
      const ctx = contextJson(row.context);
      if (ctx !== row.ctx) { mismatches.push(`ctx: ${row.utterance}`); continue; }
      const enc = tok.encodePair(row.utterance, ctx, 256);
      if (JSON.stringify(enc.inputIds) !== JSON.stringify(row.ids) || JSON.stringify(enc.typeIds) !== JSON.stringify(row.type_ids)) {
        mismatches.push(`ids: ${row.utterance}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  // 브라우저 런타임(onnxruntime-web wasm)과 Python onnxruntime(CPU)은 int8 연산 순서가 달라 거의 같은 점수인 행에서
  // 답이 갈릴 수 있다. 2026-11-15 기준 1,160행 중 9행이 갈렸고 그 9행의 정답 수는 양쪽이 3행으로 같았다.
  // 그래서 99% 이상 같은 답이면서 정답 수가 Python보다 적지 않은지를 본다.
  it("onnxruntime-web 호출 문자열이 Python과 99% 이상 같고 정답 수가 줄지 않는다", async () => {
    const ort = await import("onnxruntime-web");
    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create(readFileSync(join(dir!, "model_int8.onnx")), { executionProviders: ["wasm"] });
    const labels: ClfLabels = JSON.parse(readFileSync(join(dir!, "labels.json"), "utf-8"));
    const tok = tokenizer();
    const wrong: string[] = [];
    let webRight = 0, pyRight = 0;
    for (const row of rows()) {
      const enc = tok.encodePair(row.utterance, contextJson(row.context), 256);
      const n = enc.inputIds.length;
      const values: Record<string, number[]> = { input_ids: enc.inputIds, attention_mask: enc.attentionMask, token_type_ids: enc.typeIds };
      const feeds = Object.fromEntries(session.inputNames.map((name) =>
        [name, new ort.Tensor("int64", BigInt64Array.from(values[name], (v) => BigInt(v)), [1, n])]));
      const out = await session.run(feeds);
      const logits = Object.fromEntries(Object.entries(out).map(([k, t]) => [k, t.data as Float32Array]));
      const call = assembleCall(labels, logits);
      if (call !== row.output) wrong.push(`${row.utterance}: ${call} != ${row.output}`);
      if (row.expected !== undefined) { webRight += Number(call === row.expected); pyRight += Number(row.output === row.expected); }
    }
    console.info(`[mobile_clf] Python과 다른 행 ${wrong.length}/${rows().length}, 정답 web ${webRight} / python ${pyRight}`);
    expect(wrong.length / rows().length).toBeLessThanOrEqual(0.01);
    expect(webRight).toBeGreaterThanOrEqual(pyRight);
  }, 300_000);
});
