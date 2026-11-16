"""기능 선택 서버 (소형 분류기) — 발화 + 화면 상태 → `<hs_N>(인자=값)<hs_end>` 한 줄.

운영 서버(RAM 4GB)에는 Qwen 2B(float32 약 9GB)를 올릴 수 없어 휴대폰용 분류기 `mobile_clf`(KoELECTRA-small int8,
13.9MB)를 서버에서 돌린다. 계약은 Qwen 서버(`ml/qwen/select_server.py`)와 같아서 백엔드는
`FUNCTION_SELECTOR_ENGINE=http`, `FUNCTION_SELECTOR_URL=http://selector:8300` 만 바꾸면 된다.

    GET  /health   {"status": "ready|error", "version", "error"}
    POST /select   {"utterance": "...", "context": {...}} → {"function_call": "<hs_4>(topic=2, product=1)<hs_end>", "elapsed_ms"}

모델 파일은 휴대폰이 받는 묶음과 같은 것을 쓴다. `CLF_DIR`이 있으면 그 폴더를, 없으면 `OFFLINE_ASSETS`(기본 /offline-assets)의
`function-models.json`이 가리키는 mobile_clf 폴더를 읽는다(backend/scripts/export_browser_model.py 가 만든다).
그래서 휴대폰과 서버가 늘 같은 버전으로 고른다. 파일이 없으면 /health 가 error, /select 가 503이고 백엔드는
음성 질문만 503 FUNCTION_SELECTOR_UNAVAILABLE 로 답한다.

입력은 학습(ml/qwen/build_classifier_notebook.py)과 같다: tokenizer(발화, json.dumps(context, ensure_ascii=False,
separators=(",", ":")), truncation="only_second", max_length=256). 화면 상태는 백엔드가 compact_context 로 줄여 보낸
것을 쓰고(키 순서 포함), labels.json 의 context_format 이 'clf_v2'면 학습과 같이 키 이름과 농약 목록만 바꾼다. 출력은 검증하지 않는다. 형식·범위 검사는 백엔드 파서가 한다.
"""

import json
import logging
import os
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

logger = logging.getLogger("selector")

MAX_LENGTH = 256  # 학습과 같다
REQUIRED = ("model_int8.onnx", "tokenizer.json", "labels.json")
THREADS = int(os.getenv("SELECTOR_THREADS", "1"))

_lock = threading.Lock()
_state: dict = {"status": "error", "error": "아직 불러오지 않았습니다"}


def model_dir() -> tuple[Path, str]:
    """(분류기 폴더, 버전). CLF_DIR 이 없으면 function-models.json 의 mobile_clf 묶음"""
    if os.getenv("CLF_DIR"):
        return Path(os.environ["CLF_DIR"]), "CLF_DIR"
    root = Path(os.getenv("OFFLINE_ASSETS", "/offline-assets"))
    index = root / "function-models.json"
    if not index.is_file():
        raise FileNotFoundError(f"{index} 가 없습니다 — mobile_clf 묶음을 먼저 등록하세요 (docs/OFFLINE_WEB.md)")
    bundle = json.loads(index.read_text(encoding="utf-8")).get("mobile_clf")
    if not bundle:
        raise FileNotFoundError(f"{index} 에 mobile_clf 묶음이 없습니다")
    prefix = "/offline-assets/"
    base = str(bundle["base_url"])
    if not base.startswith(prefix):
        raise ValueError(f"예상하지 못한 base_url: {base}")
    folder = (root / base[len(prefix):]).resolve()
    if not folder.is_relative_to(root.resolve()):
        raise ValueError(f"묶음 밖을 가리키는 base_url: {base}")
    return folder, str(bundle.get("version", ""))


def assemble_call(labels: dict, outputs: dict) -> str:
    """기능 로짓 + 기능별 인자 로짓 → 호출 문자열. 값은 1부터 센다 (프론트 mobileClfSelector.assembleCall 과 같다)"""
    index = int(np.argmax(outputs["fn_logits"]))
    fn = labels["functions"][index]
    args = [f"{head['argument']}={int(np.argmax(outputs[f'{fn}.{head['argument']}'])) + 1}"
            for head in labels["heads"] if head["function"] == fn]
    return f"<hs_{index}>({', '.join(args)})<hs_end>"


# labels.json 의 context_format 이 'clf_v2'(11차~)면 학습과 같이 키를 짧은 한국어로 바꾸고 농약 목록은 개수로 넣는다.
# 휴대폰(frontend mobileClfSelector.ts)과 학습 노트북(ml/qwen/build_classifier_notebook.py)이 같은 규칙을 쓴다.
CLF_KEYS = {"ui_stage": "단계", "selected_crop": "선택작물", "predicted_crop": "예측작물", "crop_mismatch": "작물불일치",
            "prediction_mode": "방식", "category": "분류", "disease_name": "병명", "confidence": "점수", "top_predictions": "후보",
            "severity": "심각도", "decision_status": "판정", "save_status": "저장", "recapture": "재촬영", "pesticides": "농약",
            "selected_usage_id": "선택제품", "pending_target": "되물음", "name": "이름", "region": "부위"}


def _rename(value):
    if isinstance(value, dict):
        return {CLF_KEYS.get(k, k): _rename(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_rename(v) for v in value]
    return value


def clf_context(context: dict, context_format: str | None = None) -> dict:
    """분류기에 넣는 화면 상태. context_format 이 없으면(10차까지) 받은 그대로"""
    if context_format != "clf_v2":
        return context
    context = dict(context)
    if isinstance(context.get("pesticides"), list):
        context["pesticides"] = len(context["pesticides"])
    return _rename(context)


def context_text(context: dict, context_format: str | None = None) -> str:
    return json.dumps(clf_context(context, context_format), ensure_ascii=False, separators=(",", ":"))


def load() -> None:
    import onnxruntime as ort
    from tokenizers import Tokenizer

    try:
        folder, version = model_dir()
        for name in REQUIRED:
            if not (folder / name).is_file():
                raise FileNotFoundError(f"{folder / name} 가 없습니다")
        options = ort.SessionOptions()
        options.intra_op_num_threads = THREADS
        options.inter_op_num_threads = 1
        session = ort.InferenceSession(str(folder / "model_int8.onnx"), options, providers=["CPUExecutionProvider"])
        tokenizer = Tokenizer.from_file(str(folder / "tokenizer.json"))
        tokenizer.no_padding()
        tokenizer.enable_truncation(max_length=MAX_LENGTH, strategy="only_second")
        labels = json.loads((folder / "labels.json").read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001 — 이유를 /health 로 알린다
        logger.error("분류기를 불러오지 못했습니다: %s", exc)
        _state.clear()
        _state.update(status="error", error=str(exc))
        return
    _state.clear()
    _state.update(status="ready", version=version, session=session, tokenizer=tokenizer, labels=labels,
                  inputs=[i.name for i in session.get_inputs()])
    logger.info("분류기 준비 완료: %s (%s)", folder, version)


def encode(utterance: str, context: dict) -> dict[str, np.ndarray]:
    enc = _state["tokenizer"].encode(utterance, context_text(context, _state["labels"].get("context_format")))
    arrays = {"input_ids": enc.ids, "attention_mask": enc.attention_mask, "token_type_ids": enc.type_ids}
    return {name: np.asarray([arrays[name]], dtype=np.int64) for name in _state["inputs"]}


def classify(utterance: str, context: dict) -> str:
    with _lock:
        session = _state["session"]
        values = session.run(None, encode(utterance, context))
        outputs = {meta.name: value[0] for meta, value in zip(session.get_outputs(), values)}
    return assemble_call(_state["labels"], outputs)


@asynccontextmanager
async def lifespan(app: FastAPI):
    load()  # 1초 안팎
    yield


app = FastAPI(title="Cropy 기능 선택 서버 (소형 분류기)", lifespan=lifespan)


class SelectRequest(BaseModel):
    utterance: str = Field(min_length=1, max_length=300)
    context: dict = Field(default_factory=dict)


@app.get("/health")
async def health():
    labels = _state.get("labels") or {}
    return {"status": _state["status"], "version": _state.get("version"), "context_format": labels.get("context_format"),
            "error": _state.get("error")}


@app.post("/select")
async def select(req: SelectRequest):
    if _state["status"] != "ready":
        # 서버가 뜬 뒤에 묶음을 넣은 경우 다시 읽어 본다
        await run_in_threadpool(load)
    if _state["status"] != "ready":
        raise HTTPException(status_code=503, detail="기능 선택 모델이 준비되지 않았습니다.")
    started = time.perf_counter()
    call = await run_in_threadpool(classify, req.utterance.strip(), req.context)
    return {"function_call": call, "elapsed_ms": round((time.perf_counter() - started) * 1000)}
