"""오프라인 답변 핸들러(voice-handlers.mjs)의 기준 출력을 서버 handler 로 만든다.
실행 (backend 가상환경): backend/.venv/Scripts/python frontend/tests/fixtures/offline-voice/make_handler_fixtures.py
진단 상태 여러 개 × 모든 함수·인자 조합 × 화면 단계로 handle_function_output 을 돌려 handlers.json 에 적는다.
등록 농약은 오프라인 묶음과 같은 값(export_browser_model.offline_pesticides)을 쓴다.
"""
import itertools, json, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parents[3] / "backend"
sys.path.insert(0, str(BACKEND)); sys.path.insert(0, str(BACKEND / "scripts"))
from app.schemas.llm import DiagnosisLLMInput  # noqa: E402
from app.services.function_contract import contract_path  # noqa: E402
from app.services.llm_function_handler import handle_function_output  # noqa: E402
from app.services.llm_function_parser import InvalidFunctionOutput, load_function_contract  # noqa: E402
from export_browser_model import offline_pesticides  # noqa: E402

contract = load_function_contract(contract_path())
seed = json.loads((BACKEND / "app/data/seed/diseases.json").read_text(encoding="utf-8"))
pesticides, _ = offline_pesticides()
by_name = {d["name"]: d for d in seed}


def ctx(name, **over):
    d = by_name[name]
    base = dict(disease_name=d["name"], crop_type=d["crop_type"] if d["category"] != "other" else None, selected_crop=d["crop_type"],
                predicted_crop=d["crop_type"], crop_mismatch=False, prediction_mode="browser",
                decision_status="disease" if d["category"] == "disease" else ("normal" if d["category"] == "normal" else "not_crop"),
                decision_reasons=[] if d["category"] != "other" else ["not_crop"], policy_version="decision-v3:low=0.8",
                management_actions=d.get("management_actions", []), category=d["category"], severity=d.get("severity") if d["category"] != "other" else None,
                confidence=0.9123, top_predictions=[{"name": d["name"], "confidence": 0.9123}, {"name": "고추 흰가루병", "confidence": 0.05}],
                description=d.get("description"), causes=d.get("causes", []), prevention=d.get("prevention", []),
                pesticides=pesticides.get(d["model_class_id"], []), recapture=None)
    base.update(over)
    return DiagnosisLLMInput.model_validate(base).model_dump(mode="json")


radish_recapture = {"region": "잎 뒷면", "instruction": "잎을 뒤집어 뒷면을 가까이 찍어 주세요.", "margin": 0.31,
                    "candidates": [{"name": "무 검은무늬병", "cue": "동심원 무늬"}, {"name": "무 노균병", "cue": "잎 뒷면 회백색 곰팡이"}]}
names = [d["name"] for d in seed]
contexts = {
    "pepper_anthracnose": ctx("고추 탄저병"),
    "pepper_powdery_one_candidate": ctx("고추 흰가루병", top_predictions=[{"name": "고추 흰가루병", "confidence": 1.0}], confidence=1.0),
    "radish_confusion": ctx("무 검은무늬병", decision_status="confusion", decision_reasons=["confusion"], recapture=radish_recapture,
                            top_predictions=[{"name": "무 검은무늬병", "confidence": 0.55}, {"name": "무 노균병", "confidence": 0.24}], confidence=0.55),
    "cabbage_black_rot_no_pesticide": ctx(next(n for n in names if "검은썩음병" in n)),
    "pepper_normal": ctx(next(n for n in names if n.startswith("고추") and "정상" in n)),
    "not_crop": ctx("판별 불가"),
    "crop_mismatch": ctx("고추 탄저병", selected_crop="배추", crop_mismatch=True, decision_status="crop_mismatch", decision_reasons=["crop_mismatch"]),
    "low_confidence": ctx("배추 노균병", decision_status="low_confidence", decision_reasons=["low_confidence"], confidence=0.4567,
                          top_predictions=[{"name": "배추 노균병", "confidence": 0.4567}, {"name": "배추 검은썩음병", "confidence": 0.4}]),
    "legacy_mode": ctx("고추 탄저병", prediction_mode="legacy"),
    "mock_mode": ctx("고추 탄저병", prediction_mode="mock"),
    "empty": None,
}
empty_context = DiagnosisLLMInput(disease_name="", selected_crop=None, predicted_crop=None, crop_mismatch=False, prediction_mode="legacy",
                                  decision_status="", decision_reasons=[], policy_version=None, category="", severity=None, confidence=0)

calls = []
for index, spec in enumerate(contract.functions):
    ranges = [range(1, count + 1) for _, count in spec.arguments]
    for values in itertools.product(*ranges):
        args = ", ".join(f"{name}={v}" for (name, _), v in zip(spec.arguments, values))
        calls.append(f"<hs_{index}>({args})<hs_end>")
calls += ["<hs_0>(topic=8)<hs_end>", "<hs_4>(product=1, topic=1)<hs_end>", "<hs_9>()<hs_end>", "<hs_0>(topic=1)", " <hs_8>()<hs_end> "]

rows = []
for (key, c), call, stage in itertools.product(contexts.items(), calls, ["result", "no_photo", "analyzing", "error", None]):
    if stage not in ("result", None) and not call.startswith("<hs_7>"):
        continue  # 화면 단계는 사용 안내만 바꾼다
    model = DiagnosisLLMInput.model_validate(c) if c else empty_context
    try:
        r = handle_function_output(call, model, contract, ui_stage=stage)
        rows.append({"context": key, "call": call, "ui_stage": stage, "out": r.model_dump()})
    except InvalidFunctionOutput as e:
        rows.append({"context": key, "call": call, "ui_stage": stage, "error": "InvalidFunctionOutput"})
(HERE / "handlers.json").write_text(json.dumps({"contexts": contexts, "rows": rows}, ensure_ascii=False), encoding="utf-8")
print(len(rows), "rows")
