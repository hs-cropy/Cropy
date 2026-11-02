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

    if call.function_name == "get_diagnosis":
        return _diagnosis_response(call.arguments["topic"], context)

    if call.function_name == "get_prediction_metrics":
        return _metrics_response(call.arguments["topic"], context)
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


def _diagnosis_response(topic, context):
    function_name = "get_diagnosis"

    def respond(status, text):
        return _response(function_name, context, status, text)

    if topic == "provenance":
        sources = {
            "model": "서버 모델",
            "browser": "브라우저 모델",
            "mock": "데모",
        }
        source = sources.get(context.prediction_mode)
        if source is None:
            return respond(
                "insufficient_information",
                "현재 기록의 추론 출처를 확인할 수 없습니다.",
            )
        return respond(
            "ok",
            f"현재 기록의 추론 출처는 {source}입니다. "
            "이 안내를 위해 새로운 추론을 실행하지 않았습니다.",
        )

    limitations = {
        "observation": (
            "현재 입력에는 사진을 직접 관찰한 소견이 없습니다. "
            "등록된 병해 설명을 실제 사진의 관찰 소견으로 바꾸지 않습니다."
        ),
        "impact": (
            "현재 입력에는 현장 피해 면적이나 손실량이 없습니다. "
            "모델 분류 점수로 실제 피해나 수확량 감소를 계산할 수 없습니다."
        ),
        "food_safety": (
            "사진 분류만으로 식용 안전이나 잔류 농약 여부를 "
            "확인할 수 없습니다."
        ),
        "change": (
            "현재 입력에는 비교할 이전 관찰 자료가 없습니다. "
            "이번 분류만으로 회복이나 악화 추세를 판단할 수 없습니다."
        ),
    }
    if topic in limitations:
        return respond("insufficient_information", limitations[topic])

    not_crop = (
        context.category == "other"
        or context.decision_status == "not_crop"
        or "not_crop" in context.decision_reasons
    )

    if topic == "severity":
        if not_crop or context.severity is None:
            return respond(
                "insufficient_information",
                "현재 결과에는 안내할 심각도 참고 속성이 없습니다.",
            )
        labels = {"high": "높음", "medium": "보통", "low": "낮음"}
        label = labels.get(context.severity)
        if label is None:
            return respond(
                "insufficient_information",
                "현재 심각도 참고 속성의 의미를 확인할 수 없습니다.",
            )
        return respond(
            "ok",
            f"등록된 병해 정보의 심각도 참고 속성은 {label}입니다. "
            "사진에서 측정한 병의 진행 정도나 실제 피해 수준이 아닙니다.",
        )

    if not_crop:
        return respond(
            "ok",
            "현재 결과는 판별 불가입니다. 대상 작물의 잎으로 알아보기 "
            "어려워 병해 여부를 판단하지 않습니다. 잎을 선명하게 다시 찍어 주세요.",
        )

    if not context.disease_name.strip():
        return respond(
            "insufficient_information",
            "현재 입력에 분류 후보 이름이 없습니다.",
        )

    text = f"현재 기록의 분류 후보는 {context.disease_name}입니다."
    if context.category == "normal":
        text += " 정상 범주이며 병해 부재나 식용 안전을 보장하지 않습니다."
    else:
        text += " 사진 분류 결과이며 확진이 아닙니다."

    if context.crop_mismatch or (
        context.decision_status == "crop_mismatch"
        or "crop_mismatch" in context.decision_reasons
    ):
        text += " 선택한 작물과 예측한 작물이 달라 촬영 대상을 확인해야 합니다."
    if context.decision_status == "confusion" or (
        "confusion" in context.decision_reasons
    ):
        text += " 후보 구분을 위한 추가 촬영이 필요한 상태입니다."
    if context.decision_status == "low_confidence" or (
        "low_confidence" in context.decision_reasons
    ):
        text += " 낮은 모델 분류 점수로 판정을 보류한 상태입니다."

    return respond("ok", text)


def _metrics_response(topic, context):
    function_name = "get_prediction_metrics"
    limit = " 이 점수는 실제 발병 확률이나 피해 수준을 뜻하지 않습니다."

    def respond(status, text):
        return _response(function_name, context, status, text)

    if topic == "limits":
        return respond(
            "ok",
            "모델 분류 점수는 제공된 후보를 비교하기 위한 값입니다."
            + limit
            + " 점수만으로 기존 판정 상태를 변경하지 않습니다.",
        )

    if topic == "confidence":
        return respond(
            "ok",
            f"현재 결과에 기록된 모델 분류 점수는 {context.confidence}입니다."
            + limit,
        )

    candidates = context.top_predictions
    if not candidates:
        return respond(
            "insufficient_information",
            "현재 입력에는 비교할 후보 목록이 없습니다.",
        )

    if topic == "comparison":
        if len(candidates) < 2:
            return respond(
                "insufficient_information",
                "후보가 두 개 이상 제공되지 않아 점수를 비교할 수 없습니다.",
            )

        ranked = sorted(candidates, key=lambda item: item.confidence, reverse=True)
        first, second = ranked[:2]
        difference = abs(first.confidence - second.confidence)
        return respond(
            "ok",
            f"제공된 후보 중 {first.name} 점수는 {first.confidence}, "
            f"{second.name} 점수는 {second.confidence}입니다. "
            f"두 점수의 차이는 {difference:.6g}입니다."
            + limit
            + " 이 차이로 재촬영 여부를 새로 판정하지 않습니다.",
        )

    if topic == "ranking":
        candidates = sorted(
            candidates, key=lambda item: item.confidence, reverse=True
        )

    listing = "; ".join(
        f"{item.name}: {item.confidence}" for item in candidates
    )
    return respond(
        "ok",
        "제공된 후보 목록의 모델 분류 점수: "
        + listing
        + ". 제공되지 않은 후보의 점수는 알 수 없습니다."
        + limit,
    )