"""One UI decision policy for server and browser inference results."""
from app.core.config import settings

# v3: 무 질병은 1순위만으로 잎 뒷면 재촬영 안내(recapture.py trigger="top1")
POLICY_VERSION = "decision-v3"


def crop_mismatch(selected_crop, predicted_crop, category):
    # "판별 불가" has no crop to compare with the selected one.
    return bool(selected_crop and selected_crop != predicted_crop and category != "other")


def decision(confidence, mismatch, recapture, category, threshold=None):
    threshold = settings.low_confidence_threshold if threshold is None else threshold
    if category == "other":
        # No crop leaf was recognized, so mismatch/confusion/score are meaningless.
        reasons = ["not_crop"]
    else:
        reasons = []
        if mismatch:
            reasons.append("crop_mismatch")
        if recapture:
            reasons.append("confusion")
        if confidence < threshold:
            reasons.append("low_confidence")
    return {
        "decision_status": reasons[0] if reasons else ("normal" if category == "normal" else "disease"),
        "decision_reasons": reasons,
        "policy_version": f"{POLICY_VERSION}:low={threshold:g}",
    }
