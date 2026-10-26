"""Write the human review workbook for the v2 data (검수표_v2.xlsx).

Tabs: 안내, 1_결정필요 (policy decisions), 2_검증셋 (one representative per
validation group, with an AI pre-check flag), 3_변형 (generated variants).
Reviewers fill the 판정 columns; apply_review.py (next step) reads them back.
"""
import argparse
import json
import re
from collections import defaultdict
from pathlib import Path

import spec_v2

DATA = Path(__file__).resolve().parent / "data_v2"
VERDICTS = '"ok,수정,삭제"'

# Policy questions found while pre-reviewing the validation set. Rows touching them are flagged.
DECISIONS = [
    ("D1", "재촬영 안내가 비어 있으니 사진도 완벽하고 병명도 확실하다는 거지",
     "get_diagnosis(result)", "A 유지 / B get_prediction_metrics(limits) / C get_recapture_guidance(certainty)",
     "B: '확실하다'는 확진 해석 질문", {"v11:G_D_V_NULL_RECAPTURE"}),
    ("D2", "설명 중간에 궁금해졌는데 더 자세한 내용으로 넘어가 줘", "clarify_request(topic)",
     "A 유지 / B get_usage_guidance(next_step, step_by_step)", "A: 무엇의 자세한 내용인지 모호", {"v11:GRP_V8_ADD_013"}),
    ("D3", "그것부터 다시 말해줄래", "clarify_request(topic)",
     "A 유지(그것=모호) / B get_usage_guidance(repeat)", "A: '그것부터'가 대상을 가리켜 모호", {"v11:G_V5_Q_124"}),
    ("D4", "보이는 상품의 사용 조건이 검증됐는지 확인해 줘요 (제품 1개 화면)", "get_pesticide_information(verification, all)",
     "A 유지 / B product=current", "B: 화면에 제품이 하나뿐", {"v12:eval-dialogue-product_review"}),
    ("D5", "이 숫자가 분류 점수라는 뜻인가요 / 이번 모델이 준 점수의 의미를 알려줘 (15행)", "get_prediction_metrics(confidence)",
     "A 유지(설명문을 '점수 수치와 그 숫자가 무슨 점수인지'로 고침) / B topic=limits로 일괄 변경",
     "A: v11 라벨이 일관되게 confidence", set()),
    ("D6", "재촬영 안내가 없는 결과 화면에서 재촬영 이유·근거를 묻는 행", "get_recapture_guidance(...)",
     "A 유지(의도대로 라벨, 안내 없음은 handler가 답함) / B clarify_request로 변경", "A: 기능 선택은 의도 기준", set()),
    ("D7", "그래 그렇게 하자 / 좋아요 / 응 알았어 / 됐어 (결과·오류 화면)", "chit_chat()",
     "A 유지 / B 안내 중 동의는 get_usage_guidance(next_step)", "A: 단독 맞장구는 기능 요청이 아님", set()),
    ("D8", "택시 불러 줘 / 손주한테 문자 보내 줘 / 라디오 틀어 줘", "(삭제함)",
     "A 삭제 유지 / B handle_scope_limit(action) 시드로 추가 / C chit_chat으로 복원",
     "A: v11에서 '결과를 문자로 보내는 작업'이 action이라 잡담과 충돌", set()),
]
ACK = re.compile(r"^(그래 그렇게 하자|좋아요|응 알았어|됐어|그래|알겠어요|괜찮아)$")


def meaning(function, arguments):
    _, spec, description = spec_v2.FUNCTIONS[spec_v2.NAMES.index(function)]
    parts = [function]
    for arg, value in arguments.items():
        parts.append(dict(spec[arg])[value])
    return " · ".join(parts)


def context_summary(c):
    s = c.get("ui_stage", "")
    for key, label in (("disease_name", None), ("crop_mismatch", "작물불일치"), ("recapture", "재촬영안내"),
                       ("decision_status", None), ("save_status", None)):
        if c.get(key):
            s += f" / {label or c[key]}"
    if c.get("pesticides"):
        s += f" / 약{len(c['pesticides'])}개"
    return s


def precheck(rep, rows):
    reasons = [code for code, *_, groups in DECISIONS if rep["group"] in groups]
    if rep["function"] == "get_recapture_guidance" and not rep["context"].get("recapture"):
        reasons.append("D6")
    if rep["output"] == "<hs_1>(topic=1)<hs_end>" and re.search(r"(의미|뜻)", rep["user_text"]):
        reasons.append("D5")
    if rep["function"] == "chit_chat" and ACK.match(rep["user_text"]) and rep["context"].get("ui_stage") != "no_photo":
        reasons.append("D7")
    if len({r["output"] for r in rows}) > 1:
        reasons.append("같은 그룹에 다른 정답")
    return ("확인필요", ", ".join(reasons)) if reasons else ("ok", "")


def main():
    import openpyxl
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.worksheet.datavalidation import DataValidation

    p = argparse.ArgumentParser()
    p.add_argument("--data", type=Path, default=DATA)
    a = p.parse_args()
    val = [json.loads(l) for l in (a.data / "validation.jsonl").read_text(encoding="utf-8").splitlines()]
    groups = defaultdict(list)
    for r in val:
        if r["augmentation"] == "original":
            groups[r["group"]].append(r)

    wb = openpyxl.Workbook()
    bold, wrap = Font(bold=True), Alignment(wrap_text=True, vertical="top")
    flag_fill = PatternFill("solid", fgColor="FFF2CC")

    def sheet(title, header, widths):
        ws = wb.create_sheet(title)
        ws.append(header)
        for cell in ws[1]:
            cell.font = bold
        for i, w in enumerate(widths, 1):
            ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w
        ws.freeze_panes = "A2"
        return ws

    guide = wb.active
    guide.title = "안내"
    for line in [
        "Qwen 기능 선택 데이터 v2 검수표",
        "1) 1_결정필요: 정책 8건의 '결정' 칸에 A/B/C를 적는다. 결정은 같은 유형의 행 전체에 일괄 반영한다.",
        "2) 2_검증셋: validation 그룹마다 대표 문장 1개. 같은 그룹의 다른 행(띄어쓰기·오타 변형)은 같은 정답을 따른다.",
        "   'AI 사전검토'가 확인필요인 행(노란색)부터 본다. 정답이 틀리면 판정=수정, '수정 정답'에 함수(인자) 형태로 적는다.",
        "3) 3_변형: 반말·사투리·띄어쓰기 변형이 원문과 같은 뜻이고 자연스러운지 본다. 어색하면 수정/삭제.",
        "정답 표기는 '함수 · 인자 뜻' 형태. 예: get_pesticide_information · 희석 배수 · 지금 보고 있는(하나로 확인된) 제품",
        "판정 칸은 드롭다운(ok/수정/삭제). 검수자 이름을 적는다.",
    ]:
        guide.append([line])
    guide.column_dimensions["A"].width = 120

    ws = sheet("1_결정필요", ["ID", "예시 발화", "현재 정답", "선택지", "AI 추천", "결정(A/B/C)", "메모"], [6, 50, 34, 60, 40, 12, 30])
    for code, text, current, options, recommendation, _ in DECISIONS:
        ws.append([code, text, current, options, recommendation, "", ""])
    for row in ws.iter_rows(min_row=2):
        for cell in row:
            cell.alignment = wrap

    ws = sheet("2_검증셋", ["No", "그룹", "행 수", "화면 상태", "발화(대표)", "정답", "output", "AI 사전검토", "사유",
                          "판정", "수정 정답", "검수자", "메모"], [5, 30, 6, 34, 60, 48, 26, 10, 18, 8, 30, 10, 24])
    dv = DataValidation(type="list", formula1=VERDICTS, allow_blank=True)
    ws.add_data_validation(dv)
    flagged = 0
    for n, (group, rows) in enumerate(sorted(groups.items(), key=lambda kv: (kv[1][0]["function"], kv[0])), 1):
        rep = min(rows, key=lambda r: len(r["user_text"]))
        status, reason = precheck(rep, rows)
        ws.append([n, group, len(rows), context_summary(rep["context"]), rep["user_text"],
                   meaning(rep["function"], rep["arguments"]), rep["output"], status, reason, "", "", "", ""])
        dv.add(f"J{ws.max_row}")
        if status != "ok":
            flagged += 1
            for cell in ws[ws.max_row]:
                cell.fill = flag_fill

    ws = sheet("3_변형", ["case_id", "변형 종류", "원문", "변형", "정답", "판정", "수정 문장", "검수자", "메모"],
               [30, 18, 50, 50, 44, 8, 40, 10, 20])
    dv2 = DataValidation(type="list", formula1=VERDICTS, allow_blank=True)
    ws.add_data_validation(dv2)
    import csv
    with (a.data / "review_sample.csv").open(encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            fn, args = spec_v2.parse_call(r["output"])
            ws.append([r["case_id"], r["augmentation"], r["원문"], r["변형"], meaning(fn, args), "", "", "", ""])
            dv2.add(f"F{ws.max_row}")

    out = a.data / "검수표_v2.xlsx"
    wb.save(out)
    print(json.dumps(dict(file=str(out), decisions=len(DECISIONS), validation_groups=len(groups),
                          flagged=flagged, variants=ws.max_row - 1), ensure_ascii=False))


if __name__ == "__main__":
    main()
