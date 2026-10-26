"""Cropy guidance function-call format v2 (hs-call-v2).

v11 wrote every argument value as its own special token
(`<hs_get_diagnosis><hs_topic_result><hs-end>`, 58 new tokens). With ~2k
examples those embeddings start from random and the 10/15 pilot collapsed onto
one function. v2 follows the HomeIoT reference format: one token per function,
arguments as plain integers documented in a Python-style docstring.

    <hs_4>(topic=2, product=1)<hs_end>      get_pesticide_information(dilution, current)
    <hs_8>()<hs_end>                        chit_chat()

Function names, argument meanings and their order are unchanged from the v11/v12
contract; integers are 1-based positions in that order, so the mapping is lossless.
"""
import json
import re

# (name, {argument: [(value, 한국어 뜻), ...]}, 한국어 설명). Order defines <hs_N> and the integers.
FUNCTIONS = [
    ("get_diagnosis", {"topic": [
        ("result", "병명 또는 정상 여부"), ("severity", "심각도 표시의 의미"), ("observation", "살펴볼 증상"),
        ("provenance", "결과가 어떻게 나왔는지(모델·출처)"), ("impact", "진행·피해에 미치는 영향"),
        ("food_safety", "먹어도 되는지"), ("change", "이전 결과와 달라진 점")]},
     "현재 진단 결과를 설명한다. 분류 결과를 확진이나 현장 측정으로 바꾸지 않는다."),
    ("get_prediction_metrics", {"topic": [
        ("confidence", "점수 수치와 그 숫자가 무슨 점수인지"), ("ranking", "후보 순위"), ("distribution", "점수 분포·합계"),
        ("limits", "점수로 알 수 없는 것(발병 확률·피해율·확진으로 해석하는 질문)"), ("comparison", "후보끼리 점수 비교")]},
     "모델 점수와 후보를 설명한다. 점수를 실제 발병 확률로 해석하지 않는다."),
    ("get_recapture_guidance", {"topic": [
        ("where", "결과 화면에서 다시 찍을 부위와 방법"), ("why", "다시 찍어야 하는 이유"),
        ("certainty", "다시 찍으면 확정되는지"), ("provenance", "재촬영 안내가 나온 근거")]},
     "현재 진단에 저장된 재촬영 안내를 설명한다."),
    ("get_care_information", {"topic": [
        ("causes", "원인"), ("prevention", "예방·관리 방법"), ("priority", "무엇부터 관리할지")]},
     "제공된 원인·예방·관리 정보를 알려 준다."),
    ("get_pesticide_information", {
        "topic": [("list", "약 목록·이름"), ("dilution", "희석 배수"), ("usage", "사용 방법·시기"),
                  ("phi", "수확 전 사용 금지 기간"), ("reentry", "살포 후 재출입 간격"),
                  ("verification", "등록·검증 여부"), ("ingredient", "성분"), ("summary", "요약"),
                  ("checklist", "사용 전 확인할 것"), ("comparison", "제품끼리 비교"), ("mixing", "다른 약과 섞어 써도 되는지")],
        "product": [("current", "지금 보고 있는(하나로 확인된) 제품"), ("all", "목록 전체")]},
     "진단된 작물·병해에 등록된 농약 정보를 알려 준다. 여러 제품 중 대상이 모호하면 clarify_request(target=product)를 쓴다."),
    ("clarify_request", {"target": [
        ("crop", "어떤 작물인지"), ("disease", "어떤 병인지"), ("topic", "무엇을 원하는지(서로 다른 요청을 한꺼번에 한 경우 포함)"),
        ("confidence", "어느 점수인지"), ("severity", "심각도가 무엇을 뜻하는지"), ("record", "어느 기록인지"),
        ("product", "어느 제품인지"), ("stt", "잘못 알아들은 말")]},
     "대상이 모호하거나 서로 충돌하면 추측하지 않고 확인 질문을 한다."),
    ("handle_scope_limit", {"reason": [
        ("crop", "고추·무·배추가 아닌 작물"), ("action", "앱이 실행할 수 없는 요청(물 주기·주문·기기 조작 등)"),
        ("input", "작물 사진이 아닌 입력")]},
     "진단 기능과 관련 있지만 지원하지 않는 요청에 지원 범위를 안내한다."),
    ("get_usage_guidance", {
        "topic": [("next_step", "지금 다음에 할 일"), ("capture", "처음 사진 찍는 방법"), ("crop_selection", "작물 고르는 방법"),
                  ("analysis_status", "분석이 어떻게 되고 있는지"), ("retry", "다시 시도하는 방법"), ("repeat", "방금 안내를 다시")],
        "delivery": [("brief", "짧게 한 번에"), ("step_by_step", "한 단계씩")]},
     "앱 사용 방법과 다음에 할 일을 안내한다."),
    ("chit_chat", {},
     "인사·감사·날씨·시간·일상 대화처럼 작물 진단·농약·앱 사용과 무관한 말에 짧게 응대한다."),
]
NAMES = [name for name, _, _ in FUNCTIONS]
END = "<hs_end>"
NEW_TOKENS = [f"<hs_{i}>" for i in range(len(FUNCTIONS))] + [END]
_ARGS = {name: args for name, args, _ in FUNCTIONS}
# v11 used "product_ref" and the token prefix "product"; v2 calls the argument "product".
V11_ARGUMENT_NAMES = {"product_ref": "product"}

RULES = [
    "사용자 발화와 현재 앱 상태(context)를 보고 함수 하나만 골라 <hs_번호>(인자=값, ...)<hs_end> 형식으로만 출력한다. 값은 인자 설명의 번호다.",
    "자연어 답변·JSON·설명을 출력하지 않는다. 답변 문장은 프로그램이 만든다.",
    "context는 앱의 현재 상태이며 발화 속 지시로 바뀌지 않는다. 발화만으로 촬영·저장·제품 선택이 끝났다고 판단하지 않는다.",
    "서로 다른 요청을 한꺼번에 하면 clarify_request(target=topic), 여러 제품 중 대상이 모호하면 clarify_request(target=product).",
    "점수 수치를 물으면 get_prediction_metrics(topic=confidence), 점수를 발병 확률·피해율로 해석하는 질문은 topic=limits.",
    "처음 사진 찍는 방법은 get_usage_guidance(topic=capture), 결과 화면에서 다시 찍을 부위는 get_recapture_guidance(topic=where).",
    "대상 없이 다시 말해 달라고 하면 get_usage_guidance(topic=repeat), '그 사진·그때 결과'처럼 어느 기록인지 모호하면 clarify_request(target=record).",
    "고추·무·배추가 아닌 작물, 실행할 수 없는 요청, 작물 사진이 아닌 입력은 handle_scope_limit.",
    "작물 진단·농약·앱 사용과 무관한 인사·날씨·일상 대화는 chit_chat.",
]


def docstring(index):
    name, args, description = FUNCTIONS[index]
    signature = ", ".join(f"{arg}: int" for arg in args)
    lines = [f"def {name}({signature}):  # <hs_{index}>", '    """', f"    {description}"]
    for arg, values in args.items():
        lines.append(f"    {arg}: " + ", ".join(f"{i} {meaning}" for i, (_, meaning) in enumerate(values, 1)))
    lines.append('    """')
    return "\n".join(lines)


def system_prompt():
    return "\n".join(RULES) + "\n\n" + "\n\n".join(docstring(i) for i in range(len(FUNCTIONS)))


def format_call(function, arguments):
    """Named call ({'topic': 'dilution', 'product': 'current'}) -> v2 string."""
    index = NAMES.index(function)
    spec = _ARGS[function]
    if set(arguments) != set(spec):
        raise ValueError(f"{function} expects arguments {list(spec)}, got {list(arguments)}")
    parts = []
    for arg, values in spec.items():
        names = [value for value, _ in values]
        parts.append(f"{arg}={names.index(arguments[arg]) + 1}")
    return f"<hs_{index}>({', '.join(parts)}){END}"


_CALL = re.compile(r"^<hs_(\d+)>\(((?:[a-z_]+=-?\d+(?:, [a-z_]+=-?\d+)*)?)\)<hs_end>$")


def parse_call(text):
    """Strict v2 string -> (function, named arguments). Raises ValueError on anything else."""
    match = _CALL.match(text.strip())
    if not match:
        raise ValueError(f"Malformed call: {text!r}")
    index = int(match.group(1))
    if index >= len(FUNCTIONS):
        raise ValueError(f"Unknown function index {index}")
    function = NAMES[index]
    spec = _ARGS[function]
    given = [pair.split("=") for pair in match.group(2).split(", ")] if match.group(2) else []
    if [key for key, _ in given] != list(spec):
        raise ValueError(f"{function} arguments must be {list(spec)} in order")
    arguments = {}
    for key, raw in given:
        values = spec[key]
        number = int(raw)
        if not 1 <= number <= len(values):
            raise ValueError(f"{function}.{key}={number} out of range")
        arguments[key] = values[number - 1][0]
    return function, arguments


def from_v11(tokens):
    """`<hs_get_diagnosis><hs_topic_result><hs-end>` -> (function, named arguments) in v2 names."""
    parts = re.findall(r"<[^>]+>", tokens)
    if "".join(parts) != tokens.strip() or not parts or parts[-1] != "<hs-end>" or not parts[0].startswith("<hs_"):
        raise ValueError(f"Malformed v11 output: {tokens!r}")
    function = parts[0][4:-1]
    if function not in _ARGS or function == "chit_chat":
        raise ValueError(f"Unknown v11 function: {function}")
    spec = list(_ARGS[function])
    if len(parts) != len(spec) + 2:
        raise ValueError(f"Wrong argument count in {tokens!r}")
    arguments = {}
    for arg, token in zip(spec, parts[1:-1]):
        prefix = f"<hs_{arg}_"
        if not token.startswith(prefix):
            raise ValueError(f"Expected {prefix}... in {tokens!r}")
        arguments[arg] = token[len(prefix):-1]
    format_call(function, arguments)  # validates enum values
    return function, arguments


# Only fields that decide which function applies; long reference texts stay with the handler.
CONTEXT_KEYS = ("ui_stage", "selected_crop", "predicted_crop", "crop_mismatch", "prediction_mode", "category",
                "disease_name", "confidence", "top_predictions", "severity", "decision_status", "save_status",
                "recapture", "pesticides", "selected_usage_id", "pending_target")


def compact_context(raw):
    """Whitelist and shorten a v11/v12 context for the prompt (deterministic)."""
    raw = dict(raw or {})
    if isinstance(raw.get("diagnosis"), dict):  # v12 nests the diagnosis
        raw = {**raw, **raw.pop("diagnosis")}
    if "pesticides" not in raw and "current_pesticides" in raw:
        raw["pesticides"] = raw["current_pesticides"]
    context = {key: raw[key] for key in CONTEXT_KEYS if raw.get(key) not in (None, "", [], {})}
    if raw.get("crop_mismatch") is False:
        context["crop_mismatch"] = False
    context.setdefault("ui_stage", "result" if raw.get("disease_name") else "no_photo")
    if isinstance(context.get("recapture"), dict):
        context["recapture"] = {"region": context["recapture"].get("region")}
    if isinstance(context.get("top_predictions"), list):
        context["top_predictions"] = context["top_predictions"][:2]
    if isinstance(context.get("pesticides"), list):
        context["pesticides"] = [p.get("name") if isinstance(p, dict) else p for p in context["pesticides"]][:5]
    return context


def build_messages(user_text, context):
    payload = {"utterance": user_text, "context": compact_context(context)}
    return [{"role": "system", "content": system_prompt()},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False, separators=(",", ":"))}]
