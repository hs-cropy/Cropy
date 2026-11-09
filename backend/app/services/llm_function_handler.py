"""v2 함수 호출을 검증하고 저장된 진단 근거로 안내한다."""

from app.schemas.llm import DiagnosisLLMInput
from app.schemas.llm_function_response import LLMFunctionResponse
from app.services.llm_function_parser import (
    FunctionContract,
    InvalidFunctionContract,
    parse_function_output,
)
from app.services.llm_guidance import _is_not_crop


class FunctionHandlerNotImplemented(NotImplementedError):
    """형식은 유효하지만 아직 handler가 구현되지 않은 기능."""


# 정수의 의미는 hs-call-v2의 학습 계약을 따른다.
# 함수 번호와 인자 범위 검증은 모델 폴더에서 읽은 contract가 담당한다.
_TOPICS = {
    "get_diagnosis": (
        "result", "severity", "observation", "provenance",
        "impact", "food_safety", "change",
    ),
    "get_prediction_metrics": (
        "confidence", "ranking", "distribution", "limits", "comparison",
    ),
    "get_recapture_guidance": (
        "where", "why", "certainty", "provenance",
    ),
}


def handle_function_output(
    output: str,
    context: DiagnosisLLMInput,
    contract: FunctionContract,
) -> LLMFunctionResponse:
    call = parse_function_output(output, contract)

    # 생성 후 수정된 객체도 응답 전에 다시 검증한다.
    context = DiagnosisLLMInput.model_validate(context.model_dump())

    if call.function_name == "clarify_request":
        _check_handler_arguments(contract, call.function_name, "target", len(_CLARIFICATION_QUESTIONS))
        question = _CLARIFICATION_QUESTIONS[call.arguments["target"] - 1]
        return _response(call.function_name, context, "needs_clarification", question)

    topics = _TOPICS.get(call.function_name)
    if topics is None:
        raise FunctionHandlerNotImplemented(
            f"handler not implemented: {call.function_name}"
        )

    _check_handler_arguments(contract, call.function_name, "topic", len(topics))

    topic = topics[call.arguments["topic"] - 1]
    handlers = {
        "get_diagnosis": _diagnosis_response,
        "get_prediction_metrics": _metrics_response,
        "get_recapture_guidance": _recapture_response,
    }
    return handlers[call.function_name](topic, context)


def _check_handler_arguments(contract, function_name, argument, count):
    specification = next(
        item for item in contract.functions
        if item.name == function_name
    )
    if specification.arguments != ((argument, count),):
        raise InvalidFunctionContract(
            f"unsupported handler contract: {function_name}"
        )

# target의 1부터 시작하는 번호 순서는 hs-call-v2 학습 계약과 같다.
_CLARIFICATION_QUESTIONS = (
    "어떤 작물에 대해 물어보시는 건가요? 작물 이름을 알려 주세요.",
    "어떤 병에 대해 물어보시는 건가요? 병 이름을 알려 주세요.",
    "어떤 내용부터 알려 드릴까요? 한 가지씩 물어봐 주세요.",
    "어떤 점수를 말씀하시는 건가요? 궁금한 진단 후보를 알려 주세요.",
    "화면에 표시된 병의 심각도와 사진 속 작물 상태 중 어느 쪽이 궁금하세요?",
    "어느 진단 기록을 말씀하시는 건가요? 화면에서 해당 기록을 선택해 주세요.",
    "어떤 농약 제품을 말씀하시는 건가요? 제품 이름을 알려 주세요.",
    "말씀을 잘 알아듣지 못했어요. 조금 더 천천히 다시 말해 주세요.",
)


def _response(function_name, context, status, text):
    if context.prediction_mode == "mock":
        text = "데모 결과이며 실제 모델 진단이 아닙니다. " + text
    elif context.prediction_mode not in {"model", "browser"}:
        text = "추론 출처가 확인되지 않은 기록입니다. " + text

    return LLMFunctionResponse(
        function_name=function_name,
        status=status,
        text=text,
    )


def _has_reason(context, reason):
    return (
        context.decision_status == reason
        or reason in context.decision_reasons
        or (reason == "crop_mismatch" and context.crop_mismatch)
    )


def _retake_reason(context):
    if _is_not_crop(context):
        return (
            "사진에서 고추·무·배추 잎을 알아보기 어려워서예요."
        )
    if _has_reason(context, "crop_mismatch"):
        return "선택한 작물과 사진에서 분류한 작물이 달라서예요."
    if _has_reason(context, "confusion"):
        return "비슷한 병의 후보를 구분할 추가 사진이 필요해서예요."
    if _has_reason(context, "low_confidence"):
        return "사진만으로는 AI가 충분히 자신 있게 구분하지 못해서예요."
    return None


def _general_photo_actions(context):
    # 일반 관리 행동을 촬영 방법으로 잘못 안내하지 않는다.
    # 판별 불가의 management_actions는 재촬영 방법으로 구성된다.
    if not _is_not_crop(context):
        return []
    return [
        action.strip()
        for action in context.management_actions
        if action.strip()
    ]


def _recapture_response(topic, context):
    function_name = "get_recapture_guidance"
    guidance = context.recapture

    def respond(status, text):
        return _response(function_name, context, status, text)

    missing = "현재 기록에는 구체적인 촬영 안내가 저장되어 있지 않습니다."

    if topic == "certainty":
        text = (
            "다시 촬영하면 판단에 도움이 되는 단서를 더 얻을 수 있지만, "
            "확진이나 후보 구분 성공을 보장하지 않습니다."
        )
        if guidance and guidance.instruction.strip():
            text += " " + guidance.instruction.strip()
        return respond("ok", text)

    if topic == "why":
        reason = _retake_reason(context)
        if reason is None:
            return respond(
                "insufficient_information",
                "현재 기록에서 다시 촬영해야 하는 이유를 확인할 수 없습니다. "
                "점수 차이만으로 이유를 추측하지 않습니다.",
            )

        if guidance and guidance.instruction.strip():
            reason += " " + guidance.instruction.strip()
        else:
            actions = _general_photo_actions(context)
            if actions:
                reason += " 촬영 방법: " + "; ".join(actions)

        return respond("ok", reason)

    if topic == "where":
        if guidance is not None:
            region = guidance.region.strip()
            instruction = guidance.instruction.strip()
            if region and instruction:
                return respond(
                    "ok",
                    f"다시 찍을 곳은 {region}입니다. {instruction}",
                )

        actions = _general_photo_actions(context)
        if actions:
            return respond(
                "ok",
                "현재 기록에 저장된 촬영 방법입니다. "
                + "; ".join(actions),
            )

        return respond(
            "insufficient_information",
            "현재 기록에서 다시 찍을 부위와 촬영 방법을 "
            "충분히 확인할 수 없습니다.",
        )

    if guidance is None:
        return respond("insufficient_information", missing)

    return respond(
        "ok",
        "진단할 때 함께 저장된 촬영 안내예요. "
        "이 답변을 위해 사진을 새로 분석한 것은 아닙니다.",
    )


def _diagnosis_response(topic, context):
    function_name = "get_diagnosis"

    def respond(status, text):
        return _response(function_name, context, status, text)

    if topic == "provenance":
        sources = {
            "model": "서버의 AI 모델",
            "browser": "브라우저에서 실행한 AI 모델",
            "mock": "데모",
        }
        source = sources.get(context.prediction_mode)
        if source is None:
            return respond(
                "insufficient_information",
                "현재 기록을 어떤 방식으로 분석했는지 확인할 수 없습니다.",
            )
        return respond(
            "ok",
            f"현재 기록은 {source}의 결과입니다. "
            "이 답변을 위해 사진을 새로 분석하지 않았습니다.",
        )

    if topic == "observation":
        description = (context.description or "").strip()
        if _is_not_crop(context) or context.category != "disease" or not description:
            return respond(
                "insufficient_information",
                "현재 결과에서 안내할 병의 일반적인 증상 설명을 "
                "확인할 수 없습니다.",
            )
        return respond(
            "ok",
            "현재 후보로 나온 병의 등록된 설명입니다. "
            f"이 병은 보통 다음과 같은 증상이 있어요. {description} "
            "사진에서 이 증상을 직접 확인했다는 뜻은 아닙니다.",
        )

    limitations = {
        "impact": (
            "현재 기록에는 실제 피해 면적이나 손실량이 없습니다. "
            "AI가 매긴 점수로 피해나 수확량 감소를 계산할 수 없습니다."
        ),
        "food_safety": (
            "사진 분석만으로 먹어도 안전한지, 농약이 남아 있는지 "
            "확인할 수 없습니다."
        ),
        "change": (
            "비교할 이전 관찰 자료가 없습니다. "
            "이번 결과만으로 좋아졌는지 나빠졌는지 판단할 수 없습니다."
        ),
    }
    if topic in limitations:
        return respond("insufficient_information", limitations[topic])

    if topic == "severity":
        label = {
            "high": "높음",
            "medium": "보통",
            "low": "낮음",
        }.get(context.severity)
        if _is_not_crop(context) or label is None:
            return respond(
                "insufficient_information",
                "현재 결과에는 병 자체의 심각도를 안내할 정보가 없습니다.",
            )
        return respond(
            "ok",
            f"등록된 정보에서 병 자체의 심각도는 {label}입니다. "
            "사진 속 상태나 사진에서 측정한 병의 진행 정도를 뜻하지 않습니다.",
        )

    if _is_not_crop(context):
        return respond(
            "ok",
            "현재 결과는 판별 불가입니다. 대상 작물의 잎을 알아보기 "
            "어려워 병이 있는지 판단하지 않습니다. "
            "잎이 선명하게 보이도록 다시 찍어 주세요.",
        )

    if not context.disease_name.strip():
        return respond(
            "insufficient_information",
            "현재 기록에는 분류된 후보 이름이 없습니다.",
        )

    text = f"현재 기록의 분류 후보는 {context.disease_name}입니다."
    if context.category in {"normal", "healthy"}:
        text += " 정상으로 분류됐지만 병이 전혀 없거나 먹어도 안전하다는 뜻은 아닙니다."
    else:
        text += " 사진 분석 결과이며 확진이 아닙니다."

    if _has_reason(context, "crop_mismatch"):
        text += " 선택한 작물과 사진에서 분류한 작물이 달라 확인이 필요합니다."
    if _has_reason(context, "confusion"):
        text += " 후보 구분을 위한 추가 촬영이 필요한 상태입니다."
    if _has_reason(context, "low_confidence"):
        text += " AI가 충분히 자신 있게 구분하지 못해 판정을 보류한 상태입니다."

    return respond("ok", text)


def _percent(value):
    return f"{value * 100:.2f}".rstrip("0").rstrip(".") + "%"


def _metrics_response(topic, context):
    function_name = "get_prediction_metrics"
    limit = " 이 점수는 실제 발병 확률이나 피해 수준을 뜻하지 않습니다."

    def respond(status, text):
        return _response(function_name, context, status, text)

    if topic == "limits":
        return respond(
            "ok",
            "AI가 매긴 점수는 어떤 후보에 더 가깝게 분류했는지 "
            "비교하는 데 쓰는 값입니다."
            + limit
            + " 점수만으로 기존 판정 상태를 변경하지 않습니다.",
        )

    if topic == "confidence":
        return respond(
            "ok",
            f"현재 결과에 기록된 AI 점수는 {_percent(context.confidence)}입니다."
            + limit,
        )

    candidates = context.top_predictions
    if not candidates:
        return respond(
            "insufficient_information",
            "현재 기록에는 비교할 후보 목록이 없습니다.",
        )

    if topic == "comparison":
        if len(candidates) < 2:
            return respond(
                "insufficient_information",
                "후보가 두 개 이상 없어 점수를 비교할 수 없습니다.",
            )

        ranked = sorted(candidates, key=lambda item: item.confidence, reverse=True)
        first, second = ranked[:2]
        difference = (
            f"{abs(first.confidence - second.confidence) * 100:.2f}"
            .rstrip("0").rstrip(".")
        )
        return respond(
            "ok",
            f"{first.name}의 AI 점수는 {_percent(first.confidence)}, "
            f"{second.name}의 AI 점수는 {_percent(second.confidence)}입니다. "
            f"두 점수의 차이는 {difference}퍼센트포인트입니다."
            + limit
            + " 이 차이로 재촬영 여부를 새로 판정하지 않습니다.",
        )

    if topic == "ranking":
        candidates = sorted(
            candidates, key=lambda item: item.confidence, reverse=True
        )

    listing = "; ".join(
        f"{item.name}: {_percent(item.confidence)}"
        for item in candidates
    )
    return respond(
        "ok",
        "현재 기록에 있는 후보별 AI 점수입니다. "
        + listing
        + ". 기록에 없는 후보의 점수는 알 수 없습니다."
        + limit,
    )