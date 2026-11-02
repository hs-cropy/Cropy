"""음성 안내 문장: 숫자·단위 정규화, 조사, 진단 결과별 낭독 문장."""

from datetime import datetime, timezone

import pytest

from app.schemas.diagnosis import DiagnoseResponse, ManagementActionDetail, PesticideInfo, PesticideSafety, RecaptureCandidate, RecaptureGuidance
from app.services.speech_script import build_script, euro, josa, native_number, normalize_for_tts, sino_number, strip_parenthetical


@pytest.mark.parametrize(
    "n, expected",
    [(0, "영"), (1, "일"), (10, "십"), (14, "십사"), (500, "오백"), (1000, "천"),
     (2025, "이천이십오"), (10000, "만"), (35000, "삼만 오천")],
)
def test_sino_number(n, expected):
    assert sino_number(n) == expected


@pytest.mark.parametrize("n, expected", [(1, "한"), (2, "두"), (20, "스무"), (24, "스물네")])
def test_native_number(n, expected):
    assert native_number(n) == expected


@pytest.mark.parametrize(
    "text, expected",
    [
        ("물에 1000배로", "물에 천 배로"),
        ("1,000배", "천 배"),
        ("수확 2일 전", "수확 이 일 전"),
        ("3회 이내", "삼 회 이내"),
        ("24시간 후", "스물네 시간 후"),
        ("고온다습(25~30℃)", "고온다습 이십오에서 삼십 도"),
        ("갈색~흑갈색 병반", "갈색에서 흑갈색 병반"),
        ("곰팡이(포자층)가 보이면", "곰팡이가 보이면"),
        ("동심원(과녁) 무늬", "동심원 과녁 무늬"),
        ("2개월 뒤", "이 개월 뒤"),
        ("3개를", "세 개를"),
        ("0.5%", "영 점 오 퍼센트"),
        ("배수·통풍 관리", "배수, 통풍 관리"),
        ("세균(Xanthomonas) 감염", "세균 감염"),
        ("V자로 노래지면", "브이 자로 노래지면"),
        ("물 20L당 10mL", "물 이십 리터당 십 밀리리터"),
        ("100㎖/10a", "백 밀리리터 십 아르당"),
        ("2kg을", "이 킬로그램을"),
        # 숫자가 있는 괄호는 뒤에 조사가 붙어도 빼지 않고, 조사는 괄호 안 마지막 말에 맞춘다
        ("재출입 제한(24시간)을 지켜 주세요.", "재출입 제한 스물네 시간을 지켜 주세요."),
        ("희석배수(1,000배)를 지켜 주세요.", "희석배수 천 배를 지켜 주세요."),
        ("서늘한 기온(15~20℃)과 높은 습도", "서늘한 기온 십오에서 이십 도와 높은 습도"),
        ("횟수(3번)를 넘기지 마세요", "횟수 세 번을 넘기지 마세요"),
        ("간격(7일)으로 뿌림", "간격 칠 일로 뿌림"),
        ("기준(10)을 넘으면", "기준 십을 넘으면"),
    ],
)
def test_normalize_for_tts(text, expected):
    assert normalize_for_tts(text) == expected


def test_josa_follows_the_last_syllable():
    assert josa("탄저병", "이", "가") == "이"
    assert josa("명가", "이", "가") == "가"
    assert euro("시들음") == "으로"
    assert euro("이물") == "로"  # ㄹ 받침은 '로'
    assert euro("명가") == "로"


def test_strip_parenthetical_drops_active_ingredients():
    assert strip_parenthetical("명가 (가스가마이신.티아디닐 액상수화제)") == "명가"


# ── 낭독 문장 ────────────────────────────────────────────────────────────────


def _result(**overrides) -> DiagnoseResponse:
    base = dict(
        id="d1",
        disease_name="고추 탄저병",
        crop_type="고추",
        prediction_mode="model",
        category="disease",
        confidence=0.87,
        top_predictions=[],
        prevention=["병든 과실 즉시 제거·소각", "수확 후 잔재물 철저히 처리", "세 번째는 읽지 않음"],
        current_pesticides=[
            PesticideInfo(
                name="명가 (가스가마이신.티아디닐 액상수화제)",
                dilution="1000배",
                usage="발병 초부터 경엽처리",
                safety=PesticideSafety(phi_days=2),
                verification_status="verified",
            )
        ],
        created_at=datetime.now(timezone.utc),
    )
    base.update(overrides)
    return DiagnoseResponse(**base)


def test_script_confident_disease_reads_name_actions_and_pesticide():
    lines = build_script(_result())
    assert lines[0] == "고추 탄저병으로 보여요."
    assert "첫째, 병든 과실 즉시 제거, 소각." in lines
    assert "둘째, 수확 후 잔재물 철저히 처리." in lines
    assert not any("세 번째" in line for line in lines)
    # 괄호 속 유효성분은 읽지 않고, 숫자는 한글로 풀어 읽는다
    assert "등록 농약으로는 명가가 있어요." in lines
    assert "사용 방법은 발병 초부터 경엽처리예요." in lines
    assert "희석 배수는 천 배예요." in lines
    assert "수확 이 일 전까지만 쓸 수 있어요." in lines
    assert not any(ch.isdigit() for line in lines for ch in line)


def test_script_recapture_skips_pesticides():
    recapture = RecaptureGuidance(
        region="잎 뒷면",
        instruction="잎을 뒤집어 병반이 있는 부위의 뒷면을 근접 촬영하세요.",
        margin=0.1,
        candidates=[RecaptureCandidate(name="무 노균병", cue="흰 곰팡이")],
    )
    lines = build_script(_result(recapture=recapture))
    assert "정확히 가리려면 사진을 한 장 더 찍어 주세요." in lines
    assert lines[-1] == recapture.instruction
    assert not any("농약" in line for line in lines)


def test_script_never_reads_snapshot_or_unverified_pesticides_as_current_guidance():
    # 저장 당시 목록은 그 뒤 등록 해제·조건 변경됐거나 검증되지 않았을 수 있다
    snapshot_only = build_script(_result(
        pesticides=[PesticideInfo(name="과거제품", dilution="1000배", safety=PesticideSafety(phi_days=2))],
        current_pesticides=[],
    ))
    assert not any("농약" in line or "희석" in line or "전까지만" in line for line in snapshot_only)

    unverified = build_script(_result(current_pesticides=[
        PesticideInfo(name="미검증제품", dilution="500배", verification_status="legacy_unverified")]))
    assert not any("미검증제품" in line or "희석" in line for line in unverified)


@pytest.mark.parametrize("usage", ["관주처리", None])
def test_script_does_not_invent_how_to_apply_a_pesticide(usage):
    # 사용 방법을 확인하지 않고 "뿌려요"라고 지시하면 관주용 약을 살포하게 된다
    lines = build_script(_result(current_pesticides=[PesticideInfo(
        name="관주제품", dilution="1000배", usage=usage, safety=PesticideSafety(phi_days=7),
        verification_status="verified")]))
    assert not any("뿌" in line for line in lines)
    assert "희석 배수는 천 배예요." in lines
    assert ("사용 방법은 관주처리예요." in lines) == (usage is not None)


def test_script_reads_action_descriptions_before_titles():
    details = [ManagementActionDetail(title="병든 과실 즉시 제거·소각", description="병든 과실과 잔재를 주변에 남기지 마세요."),
               ManagementActionDetail(title="통풍·배수 관리", description="물이 고이지 않게 하고 통풍을 확보하세요."),
               ManagementActionDetail(title="세 번째", description="세 번째는 읽지 않음.")]
    lines = build_script(_result(management_actions=[d.title for d in details], management_action_details=details))
    assert "첫째, 병든 과실과 잔재를 주변에 남기지 마세요." in lines
    assert "둘째, 물이 고이지 않게 하고 통풍을 확보하세요." in lines
    assert not any("세 번째" in line for line in lines)

    # 설명이 없는 이전 기록은 할 일 제목을 읽는다
    titles = build_script(_result(management_actions=["감염 부위 제거"]))
    assert "첫째, 감염 부위 제거." in titles


def test_script_reads_a_description_only_when_its_title_matches():
    # 화면과 같은 기준: 같은 자리의 설명이 그 할 일의 것일 때만 읽고, 아니면 제목을 읽는다
    lines = build_script(_result(
        management_actions=["감염 부위 제거", "주변 포기 확인"],
        management_action_details=[ManagementActionDetail(title="감염 부위 제거", description="병든 잎을 따서 밭 밖으로 치우세요."),
                                   ManagementActionDetail(title="다른 할 일", description="화면에 없는 설명.")],
    ))
    assert "첫째, 병든 잎을 따서 밭 밖으로 치우세요." in lines
    assert "둘째, 주변 포기 확인." in lines
    assert not any("화면에 없는 설명" in line for line in lines)

    # 할 일 제목이 없으면 설명만으로 읽지 않는다 — 화면에도 표시되지 않는다
    orphan = build_script(_result(management_action_details=[
        ManagementActionDetail(title="감염 부위 제거", description="화면에 없는 설명.")]))
    assert not any("화면에 없는 설명" in line for line in orphan)


def test_script_follows_the_server_decision_not_a_fixed_threshold():
    # 신뢰도 0.6이어도 서버 임계값(예: 0.8) 아래면 decision_reasons에 low_confidence가 온다
    lines = build_script(_result(confidence=0.6, decision_status="low_confidence", decision_reasons=["low_confidence"]))
    assert "확실하지 않아요" in lines[0]
    # 같은 0.4라도 서버가 확정으로 판단했으면 단정한다 (화면과 같은 기준)
    assert build_script(_result(confidence=0.4))[0] == "고추 탄저병으로 보여요."


def test_script_not_crop_asks_to_retake_without_naming_a_disease():
    lines = build_script(_result(
        disease_name="판별 불가", category="other", severity=None, decision_status="not_crop",
        decision_reasons=["not_crop"], management_actions=["잎 한 장이 화면을 가득 채우도록 가까이에서 찍기"],
        management_action_details=[ManagementActionDetail(
            title="잎 한 장이 화면을 가득 채우도록 가까이에서 찍기", description="잎 한 장을 화면 가득 담아 주세요.")],
    ))
    assert lines == ["사진에서 작물 잎을 찾지 못했어요.", "이렇게 다시 찍어 주세요.", "첫째, 잎 한 장을 화면 가득 담아 주세요."]

    bare = build_script(_result(disease_name="판별 불가", category="other", decision_status="not_crop", prevention=[]))
    assert bare == ["사진에서 작물 잎을 찾지 못했어요.", "잎이 잘 보이게 다시 찍어 주세요."]


def test_script_uncertain_disease_defers_to_extension_center():
    lines = build_script(_result(confidence=0.4, decision_status="low_confidence", decision_reasons=["low_confidence"]))
    assert "확실하지 않아요" in lines[0]
    assert lines[-1] == "방제하기 전에 가까운 농업기술센터에 확인해 보세요."
    assert not any("농약" in line or "첫째" in line for line in lines)


def test_script_healthy_crop_gives_tips_without_pesticides():
    lines = build_script(_result(disease_name="고추 정상", category="normal", confidence=0.9))
    assert lines[0] == "고추는 건강한 상태로 보여요."
    assert "관리 요령을 알려드릴게요." in lines
    assert not any("농약" in line for line in lines)


def test_script_crop_mismatch_asks_to_check_crop_instead_of_judging():
    # 고추를 골랐는데 모델은 무 정상으로 봤다 — "고추는 건강해요"라고 하면 안 된다
    healthy = build_script(_result(
        disease_name="무 정상", category="normal", crop_type="고추",
        selected_crop="고추", predicted_crop="무", crop_mismatch=True,
        decision_status="crop_mismatch", decision_reasons=["crop_mismatch"],
    ))
    assert healthy == ["선택하신 작물은 고추인데, 사진은 무 잎으로 보여요.", "작물을 확인하고 다시 찍어 주세요."]

    # 병해여도 방제 안내 없이 작물 확인만 요청한다
    disease = build_script(_result(selected_crop="배추", predicted_crop="고추", crop_mismatch=True))
    assert disease[0] == "선택하신 작물은 배추인데, 사진은 고추 잎으로 보여요."
    assert len(disease) == 2
    assert not any("탄저병" in line or "농약" in line for line in disease)


def test_script_healthy_names_the_predicted_crop():
    lines = build_script(_result(
        disease_name="배추 정상", category="normal", crop_type="배추", predicted_crop="배추", confidence=0.9,
    ))
    assert lines[0] == "배추는 건강한 상태로 보여요."


def test_script_marks_mock_results():
    lines = build_script(_result(prediction_mode="mock"))
    assert lines[0].startswith("지금은 시험용 결과예요")


def test_script_josa_for_name_ending_in_rieul():
    assert build_script(_result(disease_name="테스트 시들음", pesticides=[]))[0] == "테스트 시들음으로 보여요."
    assert build_script(_result(disease_name="테스트 이물", pesticides=[]))[0] == "테스트 이물로 보여요."
