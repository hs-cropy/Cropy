"""주입된 비동기 LLM 호출에 시간 제한과 템플릿 대체 응답을 적용한다."""
import asyncio
import math
from collections.abc import Awaitable, Callable

from app.schemas.llm import DiagnosisLLMInput
from app.schemas.llm_response import LLMGuidanceResponse

LLMCaller = Callable[[dict], Awaitable[str]]


def _is_not_crop(context: DiagnosisLLMInput) -> bool:
    return (
        context.category == "other"
        or context.decision_status == "not_crop"
        or "not_crop" in context.decision_reasons
    )


def _template(context: DiagnosisLLMInput) -> str:
    # 기존 판정 결과를 표시한다. 임계값이나 판정 정책을 여기서 재계산하지 않는다.
    lines = []
    if context.prediction_mode == "mock":
        lines.append("데모(Mock) 결과입니다. 실제 모델 진단 결과가 아닙니다.")
    elif context.prediction_mode not in {"model", "browser"}:
        lines.append("추론 출처가 확인되지 않아 진단 확정 안내를 제공하지 않습니다.")
    if _is_not_crop(context):
        lines.append(
            "사진에서 대상 작물의 잎을 알아보기 어렵습니다. "
            "병해 여부를 판단하지 않고 재촬영을 안내합니다."
        )
        if context.management_actions:
            lines.append(
                "재촬영 방법: " + "; ".join(context.management_actions)
            )
        else:
            lines.append(
                "고추·무·배추 잎 한 장이 화면을 가득 채우도록 "
                "밝은 곳에서 초점을 맞춰 다시 찍어 주세요."
            )
        return "\n".join(lines)
    if context.crop_mismatch or context.decision_status == "crop_mismatch" or "crop_mismatch" in context.decision_reasons:
        lines.append(f"작물 불일치: 선택 작물 {context.selected_crop or '미지정'}, 예측 작물 {context.predicted_crop or '미확인'}")
        lines.append("선택한 작물과 촬영 대상을 확인해 주세요.")
    if context.decision_status == "low_confidence" or "low_confidence" in context.decision_reasons:
        lines.append("기존 판정 정책에 따라 신뢰도가 낮아 판정을 보류합니다. 재촬영해 주세요.")
    if context.decision_status == "confusion" or "confusion" in context.decision_reasons:
        lines.append("기존 판정 정책에 따라 후보 구분을 위한 재촬영이 필요합니다.")
    if context.decision_reasons:
        lines.append("판정 사유: " + "; ".join(context.decision_reasons))
    confirmed = (context.prediction_mode in {"model", "browser"} and not context.crop_mismatch
                 and context.decision_status in {"normal", "disease"} and not context.decision_reasons)
    if confirmed:
        lines.append(f"모델 분류 결과: {context.disease_name}")
        lines.append("이 결과는 확정 진단이 아니며, 필요하면 전문가에게 확인해 주세요.")
        if context.crop_type:
            lines.append(f"대상 작물: {context.crop_type}")
        if context.description:
            lines.append(f"등록된 설명: {context.description}")
        if context.prevention:
            lines.append("등록된 예방 안내: " + "; ".join(context.prevention))
    elif not lines:
        lines.append(f"기존 판정 상태: {context.decision_status}. 확인 또는 재촬영이 필요합니다.")
    if context.management_actions:
        lines.append("등록된 관리 안내: " + "; ".join(context.management_actions))
    if context.recapture:
        lines.append(f"재촬영 안내: {context.recapture.instruction}")
    return "\n".join(lines)



async def generate_guidance(
    context: DiagnosisLLMInput,
    caller: LLMCaller | None = None,
    *,
    timeout_seconds: float = 10.0,
) -> LLMGuidanceResponse:
    """caller는 취소 가능한 비동기 함수여야 한다. 요청 취소는 그대로 전파한다."""
    if not math.isfinite(timeout_seconds) or timeout_seconds <= 0:
        raise ValueError("timeout_seconds must be finite and positive")
    # 생성 후 직접 수정된 객체도 호출 전에 재검증한다. 검증 실패는 대체하지 않는다.
    context = DiagnosisLLMInput.model_validate(context.model_dump())

    def fallback(reason):
        return LLMGuidanceResponse(text=_template(context), source="template", fallback_reason=reason)

    if _is_not_crop(context):
        return fallback("not_crop")

    if caller is None:
        return fallback("unavailable")

    async def invoke():
        return await caller(context.model_dump(mode="json"))

    try:
        result = await asyncio.wait_for(invoke(), timeout=timeout_seconds)
    except TimeoutError:
        return fallback("timeout")
    except Exception:
        # 인증 정보나 제공자 내부 오류를 사용자 응답에 포함하지 않는다.
        # asyncio.CancelledError는 BaseException이므로 이 분기에서 삼키지 않는다.
        return fallback("error")
    if not isinstance(result, str) or not result.strip():
        return fallback("invalid_response")
    return LLMGuidanceResponse(text=result.strip(), source="llm")
