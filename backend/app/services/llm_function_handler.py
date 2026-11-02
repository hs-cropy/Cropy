"""기능 토큰을 검증하고 현재 컨텍스트의 재촬영 안내를 반환한다."""

from app.schemas.llm import DiagnosisLLMInput
from app.schemas.llm_function_response import LLMFunctionResponse
from app.services.llm_function_parser import parse_function_output


class FunctionHandlerNotImplemented(NotImplementedError):
    """형식은 유효하지만 아직 handler가 구현되지 않은 기능."""


def handle_function_output(
    output: str,
    context: DiagnosisLLMInput,
) -> LLMFunctionResponse:
    # 문자열을 다시 파싱하므로 직접 만든 함수명이나 인자로 우회할 수 없다.
    call = parse_function_output(output)

    # 생성 후 수정된 객체의 수치도 다시 검증한다.
    context = DiagnosisLLMInput.model_validate(context.model_dump())

    if call.function_name != "get_recapture_guidance":
        raise FunctionHandlerNotImplemented(
            f"handler not implemented: {call.function_name}"
        )

    topic = call.arguments["topic"]
    guidance = context.recapture

    def respond(status: str, text: str) -> LLMFunctionResponse:
        if context.prediction_mode == "mock":
            text = "데모 결과에 연결된 안내입니다. " + text
        elif context.prediction_mode not in {"model", "browser"}:
            text = "추론 출처가 확인되지 않은 기록의 안내입니다. " + text

        return LLMFunctionResponse(
            function_name=call.function_name,
            status=status,
            text=text,
        )

    missing = (
        "현재 기록에는 재촬영 안내가 저장되어 있지 않아 "
        "특정 부위나 촬영 이유를 만들어 안내할 수 없습니다."
    )

    if topic == "certainty":
        text = (
            "재촬영은 추가 단서를 얻기 위한 것이며 "
            "확진이나 후보 구분 성공을 보장하지 않습니다."
        )
        if guidance and guidance.instruction.strip():
            text += " 저장된 촬영 지침: " + guidance.instruction.strip()
        else:
            text += " " + missing
        return respond("ok", text)

    if guidance is None:
        return respond("insufficient_information", missing)

    if topic == "provenance":
        return respond(
            "ok",
            "현재 제공된 진단 컨텍스트의 recapture 필드에 연결된 "
            "안내를 읽고 있습니다. 새로운 모델 추론을 실행한 것은 아닙니다.",
        )

    instruction = guidance.instruction.strip()
    region = guidance.region.strip()

    if topic == "where":
        if not region or not instruction:
            return respond(
                "insufficient_information",
                "현재 재촬영 부위와 촬영 지침이 충분히 제공되지 않았습니다.",
            )
        return respond(
            "ok",
            f"안내 부위: {region}. 저장된 촬영 지침: {instruction}",
        )

    # 점수 차이만으로 '가깝다'거나 재촬영이 필요하다고 새로 판정하지 않는다.
    if context.decision_status == "not_crop" or (
        context.category == "other"
        or "not_crop" in context.decision_reasons
    ):
        reason = "현재 판정 사유는 대상 작물의 잎으로 알아보기 어렵다는 것입니다."
    elif context.crop_mismatch or (
        context.decision_status == "crop_mismatch"
        or "crop_mismatch" in context.decision_reasons
    ):
        reason = "현재 판정 사유는 선택한 작물과 예측한 작물의 불일치입니다."
    elif context.decision_status == "confusion" or (
        "confusion" in context.decision_reasons
    ):
        reason = "현재 판정 사유는 후보 구분을 위한 추가 촬영입니다."
    elif context.decision_status == "low_confidence" or (
        "low_confidence" in context.decision_reasons
    ):
        reason = "현재 판정 사유는 낮은 모델 분류 점수입니다."
    else:
        return respond(
            "insufficient_information",
            "재촬영 안내는 있지만 현재 컨텍스트에서 그 판정 이유를 "
            "확인할 수 없습니다. 점수 차이만으로 이유를 추측하지 않습니다.",
        )

    if instruction:
        reason += " 저장된 촬영 지침: " + instruction

    return respond("ok", reason)