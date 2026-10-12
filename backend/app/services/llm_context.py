"""네트워크 호출 없이 진단 응답을 명시적인 LLM 입력 계약으로 변환한다."""

from app.schemas.diagnosis import DiagnoseResponse
from app.schemas.llm import DiagnosisLLMInput


def build_llm_input(diagnosis: DiagnoseResponse) -> DiagnosisLLMInput:
    """허용된 필드만 복사한다. 없는 정보나 농약 수치를 추측하지 않는다."""
    return DiagnosisLLMInput(
        disease_name=diagnosis.disease_name,
        crop_type=diagnosis.crop_type,
        selected_crop=diagnosis.selected_crop,
        predicted_crop=diagnosis.predicted_crop,
        crop_mismatch=diagnosis.crop_mismatch,
        prediction_mode=diagnosis.prediction_mode,
        decision_status=diagnosis.decision_status,
        decision_reasons=list(diagnosis.decision_reasons),
        policy_version=diagnosis.policy_version,
        management_actions=list(diagnosis.management_actions),
        category=diagnosis.category,
        severity=diagnosis.severity,
        confidence=diagnosis.confidence,
        top_predictions=[item.model_copy(deep=True) for item in diagnosis.top_predictions],
        description=diagnosis.description,
        causes=list(diagnosis.causes),
        prevention=list(diagnosis.prevention),
        pesticides=[item.model_copy(deep=True) for item in diagnosis.pesticides],
        recapture=diagnosis.recapture.model_copy(deep=True) if diagnosis.recapture else None,
    )
