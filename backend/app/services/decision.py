"""One UI decision policy for server and browser inference results."""
from app.core.config import settings

POLICY_VERSION = "decision-v2"


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
