"""혼동쌍 유도·다시점 융합 로직 단위 테스트 (모델 없이 순수 함수만 검증)."""

import pytest

from app.services.recapture import apply_pair_specialist, check_recapture, fuse_predictions

# 무 전용 2-클래스 분류기의 출력 예: 노균병(3) 우세
MU_SPEC = {2: 0.2, 3: 0.8}


def test_check_recapture_triggers_on_narrow_margin():
    guidance = check_recapture(
        [(2, 0.45), (3, 0.40), (0, 0.15)],
        {2: "무 검은무늬병", 3: "무 노균병"},
    )
    assert guidance is not None
    assert guidance.region == "잎 뒷면"
    assert {c.name for c in guidance.candidates} == {"무 검은무늬병", "무 노균병"}


def test_check_recapture_skips_wide_margin():
    assert check_recapture([(4, 0.90), (5, 0.05)], {4: "a", 5: "b"}) is None


def test_check_recapture_skips_non_confusion_pair():
    assert check_recapture([(0, 0.45), (1, 0.40)], {0: "a", 1: "b"}) is None


def test_mu_top1_triggers_even_when_model_is_confident():
    # 무 질병은 확신하며 틀리므로 마진이 넓어도 잎 뒷면 재촬영을 안내한다
    guidance = check_recapture([(3, 0.79), (7, 0.15), (2, 0.06)], {2: "무 검은무늬병", 3: "무 노균병"})
    assert guidance is not None
    assert guidance.region == "잎 뒷면"
    assert [c.name for c in guidance.candidates] == ["무 노균병", "무 검은무늬병"]
    assert guidance.margin == pytest.approx(0.64)


def test_mu_top1_triggers_when_second_is_outside_pair():
    assert check_recapture([(2, 0.55), (7, 0.40), (3, 0.05)], {2: "a", 3: "b"}) is not None


def test_mu_top1_does_not_repeat_after_refinement():
    # 재촬영을 반영한 결과에는 마진 조건만 적용해 같은 안내가 반복되지 않는다
    assert check_recapture([(3, 0.79), (2, 0.15)], {2: "a", 3: "b"}, refined=True) is None
    assert check_recapture([(3, 0.45), (2, 0.40)], {2: "a", 3: "b"}, refined=True) is not None


def test_non_mu_top1_keeps_margin_rule():
    # 배추 쌍과 무정상(7)은 넓힌 조건 대상이 아니다
    assert check_recapture([(4, 0.90), (5, 0.05)], {4: "a", 5: "b"}) is None
    assert check_recapture([(7, 0.60), (2, 0.30)], {2: "a", 7: "b"}) is None


def test_fuse_predictions_weights_second_shot():
    fused = dict(fuse_predictions([(2, 0.6), (3, 0.4)], [(2, 0.1), (3, 0.9)]))
    # 판별부위를 찍은 2차 촬영 가중이 커서 노균병(3)이 역전한다
    assert fused[3] > fused[2]
    assert fused[2] + fused[3] == pytest.approx(1.0)


def test_pair_specialist_redistributes_within_its_own_pair():
    first = [(2, 0.45), (3, 0.40), (0, 0.15)]
    out = dict(apply_pair_specialist(list(first), MU_SPEC, first))
    # 쌍의 합계 질량은 보존하고 내부 비중만 전문가 확률로 대체
    assert out[2] + out[3] == pytest.approx(0.85)
    assert out[0] == pytest.approx(0.15)
    assert out[3] > out[2]


def test_pair_specialist_skipped_for_other_confusion_pair():
    """배추 혼동쌍(4·5) 재촬영에 무 전용 분류기가 적용되면 안 된다."""
    first = [(4, 0.45), (5, 0.40), (2, 0.10), (3, 0.05)]
    assert apply_pair_specialist(list(first), MU_SPEC, first) == first


def test_pair_specialist_noop_without_model():
    fused = [(2, 0.5), (3, 0.5)]
    assert apply_pair_specialist(list(fused), None, fused) == fused
