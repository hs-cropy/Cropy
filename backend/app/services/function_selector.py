"""발화 + 화면 상태 → 기능 호출 문자열. 서버 경유 기능 선택기.

기능 선택 모델(Qwen)은 백엔드 프로세스에 올리지 않는다(메모리·의존성). 별도 서버가 같은 계약으로
`POST /select {"utterance", "context"}` → `{"function_call": "<hs_N>(…)<hs_end>"}`를 내고 여기서는 HTTP로 넘긴다.
브라우저·보드에서 모델을 직접 돌리는 경우에는 이 모듈을 거치지 않고 결과 문자열만 /voice/function-call로 보낸다.

  FUNCTION_SELECTOR_ENGINE=off   — 서버 경유 선택 비활성 (기본). 엔드포인트가 503.
  FUNCTION_SELECTOR_ENGINE=mock  — 화면 상태만 보고 고정 호출을 돌려준다. 모델 서버 없이 전 구간 테스트용.
  FUNCTION_SELECTOR_ENGINE=http  — FUNCTION_SELECTOR_URL의 /select 호출.
"""

import logging

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


class FunctionSelectorUnavailableError(RuntimeError):
    """기능을 고를 수 없음 — 엔진이 꺼져 있거나 모델 서버가 응답하지 않음."""


def mock_select(context: dict) -> str:
    # 결과 화면이면 진단 결과 설명(get_diagnosis.result), 아니면 다음 할 일 안내(get_usage_guidance.next_step, brief)
    if context.get("ui_stage") == "result" and context.get("disease_name"):
        return "<hs_0>(topic=1)<hs_end>"
    return "<hs_7>(topic=1, delivery=1)<hs_end>"


def select(utterance: str, context: dict) -> str:
    engine = settings.function_selector_engine
    if engine == "off":
        raise FunctionSelectorUnavailableError("FUNCTION_SELECTOR_ENGINE=off")
    if engine == "mock":
        return mock_select(context)

    try:
        response = httpx.post(f"{settings.function_selector_url.rstrip('/')}/select",
                              json={"utterance": utterance, "context": context},
                              timeout=settings.function_selector_timeout_seconds)
    except httpx.HTTPError as exc:
        logger.warning("function selector unreachable: %s", exc)
        raise FunctionSelectorUnavailableError(str(exc)) from exc
    if response.status_code != 200:
        logger.warning("function selector returned %s: %s", response.status_code, response.text[:200])
        raise FunctionSelectorUnavailableError(f"status {response.status_code}")

    try:
        call = response.json().get("function_call")
    except ValueError as exc:
        raise FunctionSelectorUnavailableError("invalid selector response") from exc
    if not isinstance(call, str) or not call.strip():
        raise FunctionSelectorUnavailableError("invalid selector response")
    return call.strip()
