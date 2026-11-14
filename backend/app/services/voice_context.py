"""기능 선택 모델에 넣는 화면 상태(context). 학습 때의 `ml/qwen/spec_v2.compact_context`와 같은 규칙이다.

기능을 고르는 데 필요한 짧은 값만 넣고, 긴 참고 문장(원인·관리·농약 조건)은 handler가 따로 읽는다.
키 순서와 줄임 규칙이 학습 데이터와 같아야 모델 입력이 같아진다.
"""

from typing import Literal

from app.schemas.diagnosis import DiagnoseResponse

UiStage = Literal["no_photo", "photo_ready", "analyzing", "result", "error"]

# 학습 데이터의 context 키 순서 (spec_v2.CONTEXT_KEYS)
CONTEXT_KEYS = ("ui_stage", "selected_crop", "predicted_crop", "crop_mismatch", "prediction_mode", "category",
                "disease_name", "confidence", "top_predictions", "severity", "decision_status", "save_status",
                "recapture", "pesticides", "selected_usage_id", "pending_target")


def compact_context(diagnosis: DiagnoseResponse | None, ui_stage: UiStage | None = None) -> dict:
    """진단 응답에서 기능 선택에 쓰는 값만 뽑아 학습 때와 같은 꼴로 만든다. 진단이 없으면 화면 단계만."""
    raw: dict = {}
    if diagnosis is not None:
        raw = {
            "selected_crop": diagnosis.selected_crop,
            "predicted_crop": diagnosis.predicted_crop,
            "crop_mismatch": diagnosis.crop_mismatch,
            "prediction_mode": diagnosis.prediction_mode,
            "category": diagnosis.category,
            "disease_name": diagnosis.disease_name,
            "confidence": diagnosis.confidence,
            "top_predictions": [{"name": p.name, "confidence": p.confidence} for p in diagnosis.top_predictions],
            "severity": diagnosis.severity,
            "decision_status": diagnosis.decision_status,
            "save_status": diagnosis.save_status,
            "recapture": diagnosis.recapture.model_dump() if diagnosis.recapture else None,
            "pesticides": [p.name for p in (diagnosis.pesticides or diagnosis.current_pesticides)],
        }
    if ui_stage:
        raw["ui_stage"] = ui_stage

    context = {key: raw[key] for key in CONTEXT_KEYS if raw.get(key) not in (None, "", [], {})}
    if raw.get("crop_mismatch") is False:
        context["crop_mismatch"] = False
    context.setdefault("ui_stage", "result" if raw.get("disease_name") else "no_photo")
    if isinstance(context.get("recapture"), dict):
        context["recapture"] = {"region": context["recapture"].get("region")}
    if isinstance(context.get("top_predictions"), list):
        context["top_predictions"] = context["top_predictions"][:2]
    if isinstance(context.get("pesticides"), list):
        context["pesticides"] = context["pesticides"][:5]
    # 키 순서를 학습 데이터와 같게 유지한다 (crop_mismatch=False·ui_stage 기본값이 뒤에 붙었을 수 있다)
    return {key: context[key] for key in CONTEXT_KEYS if key in context}
