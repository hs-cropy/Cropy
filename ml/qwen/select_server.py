"""기능 선택 모델 서버 — 발화 + 화면 상태 → `<hs_N>(인자=값)<hs_end>` 한 줄.

백엔드의 `POST /api/v1/voice/select-function`(FUNCTION_SELECTOR_ENGINE=http)이 이 서버를 부른다. 모델은 백엔드
프로세스에 올리지 않는다(메모리 약 9GB, 의존성 충돌). 브라우저·보드에서 모델을 직접 돌리는 기기(아이폰 분류기,
PC·안드로이드 Qwen q4f16, 오렌지파이 RKLLM)는 이 서버 없이 같은 문자열을 만든다 — 입력(발화, compact_context,
cropy_prompt.json의 시스템 프롬프트)과 출력 계약이 여기와 같아야 한다.

    python -m uvicorn select_server:app --app-dir ml/qwen --host 127.0.0.1 --port 8300

    GET  /health   {"status": "loading|ready|error", "model", "load_seconds", "prefix_tokens", "busy"}
    POST /select   {"utterance": "...", "context": {...}} → {"function_call": "<hs_4>(topic=2, product=1)<hs_end>",
                   "input_tokens", "new_tokens", "elapsed_ms"}

환경 변수
    QWEN_DIR      병합 모델 폴더 (cropy_prompt.json 포함). 기본 ml/qwen/models/merged_hf
    QWEN_THREADS  CPU 스레드 수. 0이면 torch 기본값 (성능 코어 6 + 효율 코어 10 PC에서 8이 16보다 약 10% 빨랐다)
    QWEN_DEVICE   cpu | cuda. 기본은 cuda가 있으면 cuda

출력은 검증하지 않고 그대로 돌려준다. 형식·범위 검사는 백엔드 파서(hs-call-v2)가 하고, 틀리면 400으로
"질문을 잘 이해하지 못했어요"가 된다. 여기서 고쳐 쓰면 모델 오류가 숨는다.
인증은 없다. STT·TTS 서버처럼 같은 PC(127.0.0.1)나 보드 안에서만 부른다.
"""

import copy
import json
import logging
import os
import re
import sys
import threading
import time
from collections.abc import Mapping
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import spec_v2  # noqa: E402  — compact_context: 학습 때와 같은 화면 상태 줄임 규칙

QWEN_DIR = Path(os.getenv("QWEN_DIR", HERE / "models" / "merged_hf"))
QWEN_THREADS = int(os.getenv("QWEN_THREADS", "8"))
QWEN_DEVICE = os.getenv("QWEN_DEVICE", "")
MAX_NEW_TOKENS = 16
CALL = re.compile(r"^<hs_(\d+)>\(((?:[a-z_]+=-?\d+(?:, [a-z_]+=-?\d+)*)?)\)<hs_end>$")

logger = logging.getLogger("select")
_qwen: dict = {"status": "loading"}
_lock = threading.Lock()
_busy = {"select": 0}


def _load() -> None:
    try:
        import torch
        import transformers
        from transformers import AutoTokenizer

        if QWEN_THREADS:
            torch.set_num_threads(QWEN_THREADS)
        device = QWEN_DEVICE or ("cuda" if torch.cuda.is_available() else "cpu")
        prompt = json.loads((QWEN_DIR / "cropy_prompt.json").read_text(encoding="utf-8"))
        if list(prompt["functions"]) != spec_v2.NAMES:
            raise RuntimeError(f"모델의 기능 목록이 spec_v2와 다릅니다: {list(prompt['functions'])}")
        tokenizer = AutoTokenizer.from_pretrained(QWEN_DIR)
        started = time.perf_counter()
        # CPU는 float32로 올린다(약 9GB). bfloat16 명령이 없는 CPU에서는 bfloat16이 흉내 내기로 돌아 수십 배 느렸다.
        dtype = torch.bfloat16 if device == "cuda" else torch.float32
        model = transformers.Qwen3_5ForConditionalGeneration.from_pretrained(
            QWEN_DIR, dtype=dtype, attn_implementation="sdpa").to(device).eval()
        _qwen.update(torch=torch, tokenizer=tokenizer, model=model, prompt=prompt, device=device,
                     end_id=tokenizer.convert_tokens_to_ids(prompt["stop_token"]))
        _build_prefix_cache()
        _qwen.update(status="ready", load_seconds=round(time.perf_counter() - started, 1))
        logger.info("기능 선택 모델 준비 (%s, %.1f초, 캐시한 앞부분 %d토큰)", device, _qwen["load_seconds"], len(_qwen["prefix_ids"]))
    except Exception as exc:  # noqa: BLE001 — 서버는 띄워 두고 /health로 원인을 보여 준다
        logger.exception("기능 선택 모델 로드 실패")
        _qwen.update(status="error", error=str(exc))


def _input_ids(utterance: str, context: dict) -> list[int]:
    q = _qwen
    user = json.dumps({"utterance": utterance, "context": context}, ensure_ascii=False, separators=(",", ":"))
    ids = q["tokenizer"].apply_chat_template(
        [{"role": "system", "content": q["prompt"]["system_prompt"]}, {"role": "user", "content": user}],
        tokenize=True, add_generation_prompt=True, enable_thinking=False)
    if isinstance(ids, Mapping):
        ids = ids["input_ids"]
    ids = ids.tolist() if hasattr(ids, "tolist") else list(ids)
    return ids[0] if ids and isinstance(ids[0], list) else ids


def _build_prefix_cache() -> None:
    """모든 요청에 똑같이 붙는 앞부분(시스템 프롬프트 약 1,160토큰)의 상태를 한 번만 계산해 둔다.

    요청마다 발화·화면 상태만 새로 읽는다. 출력은 캐시 없이 돌린 것과 같다(2026-11-05 비교).
    보드의 RKLLM 프롬프트 캐시, 웹의 prefix_state.py와 같은 방식이다.
    """
    q = _qwen
    a, b = _input_ids("가", {"x": 1}), _input_ids("나나나", {"y": 2})
    n = next(i for i, (x, y) in enumerate(zip(a, b)) if x != y)
    with q["torch"].no_grad():
        out = q["model"](input_ids=q["torch"].tensor([a[:n]], device=q["device"]), use_cache=True)
    q.update(prefix_ids=a[:n], prefix_cache=out.past_key_values)


def _ask(utterance: str, context: dict) -> dict:
    q = _qwen
    torch, tokenizer, model = q["torch"], q["tokenizer"], q["model"]
    ids = _input_ids(utterance, context)
    prefix = q["prefix_ids"]
    started = time.perf_counter()
    with _lock, torch.no_grad():
        kwargs = {}
        if ids[:len(prefix)] == prefix and len(ids) > len(prefix):
            kwargs["past_key_values"] = copy.deepcopy(q["prefix_cache"])  # 원본은 다음 요청을 위해 그대로 둔다
        out = model.generate(input_ids=torch.tensor([ids], device=q["device"]), max_new_tokens=MAX_NEW_TOKENS,
                             do_sample=False, eos_token_id=[q["end_id"], tokenizer.eos_token_id],
                             pad_token_id=tokenizer.pad_token_id or tokenizer.eos_token_id, **kwargs)
    seq = out[0, len(ids):].tolist()
    seq = seq[:seq.index(q["end_id"]) + 1] if q["end_id"] in seq else seq
    return {"function_call": tokenizer.decode(seq, skip_special_tokens=False).strip(), "input_tokens": len(ids),
            "new_tokens": len(ids) - len(prefix) if kwargs else len(ids),
            "elapsed_ms": round((time.perf_counter() - started) * 1000)}


@asynccontextmanager
async def lifespan(app: FastAPI):
    threading.Thread(target=_load, daemon=True).start()  # 수십 초 걸린다. 그동안 /health가 loading을 알린다
    yield


app = FastAPI(title="Cropy 기능 선택 모델 서버", lifespan=lifespan)


class SelectRequest(BaseModel):
    utterance: str = Field(min_length=1, max_length=300)
    context: dict = Field(default_factory=dict)


@app.get("/health")
async def health():
    return {"status": _qwen["status"], "error": _qwen.get("error"), "model": str(QWEN_DIR),
            "device": _qwen.get("device"), "load_seconds": _qwen.get("load_seconds"),
            "prefix_tokens": len(_qwen["prefix_ids"]) if "prefix_ids" in _qwen else None, "busy": dict(_busy)}


@app.post("/select")
async def select(req: SelectRequest):
    if _qwen["status"] != "ready":
        raise HTTPException(status_code=503, detail=f"기능 선택 모델 준비 중입니다 ({_qwen['status']}).")
    # 백엔드·브라우저가 이미 줄인 화면 상태를 보내지만, 같은 규칙을 한 번 더 적용해 입력이 학습 때와 같게 한다(멱등)
    context = spec_v2.compact_context(req.context)
    _busy["select"] += 1
    try:
        result = await run_in_threadpool(_ask, req.utterance.strip(), context)
    finally:
        _busy["select"] -= 1
    if not CALL.match(result["function_call"]):
        logger.warning("형식에 맞지 않는 출력: %r (발화 %r)", result["function_call"], req.utterance)
    return result
