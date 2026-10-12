"""Hand-checked artifacts exercise paired resolution comparison and its guards."""

import hashlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest


SCRIPT = Path(__file__).resolve().parents[1] / "compare_resolution_finetune.py"
SOURCE_BYTES = b"source checkpoint fixture"
SOURCE_SHA256 = hashlib.sha256(SOURCE_BYTES).hexdigest()
SUPPORT = [1000, 1000, 100, 24, 500, 500, 400, 446, 100]


def comparison_module(monkeypatch):
    assert SCRIPT.exists(), "The resolution comparison CLI has not been implemented"
    monkeypatch.syspath_prepend(str(SCRIPT.parent))
    spec = importlib.util.spec_from_file_location("compare_resolution_finetune", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def metrics(improved=False):
    cm = [[0] * 9 for _ in range(9)]
    for i, count in enumerate(SUPPORT):
        cm[i][i] = count
    if improved:
        cm[2][2], cm[2][3] = 96, 4
        cm[3][2], cm[3][3], cm[3][8] = 2, 21, 1
        accuracy = 4063 / 4070
        macro_f1 = (6 + 192 / 198 + 42 / 49 + 200 / 201) / 9
        recall = [1, 1, .96, .875, 1, 1, 1, 1, 1]
    else:
        cm[2][2], cm[2][3] = 94, 6
        cm[3][2], cm[3][3], cm[3][8] = 3, 19, 2
        accuracy = 4059 / 4070
        macro_f1 = (6 + 188 / 197 + 38 / 49 + 200 / 202) / 9
        recall = [1, 1, .94, 19 / 24, 1, 1, 1, 1, 1]
    return dict(accuracy=accuracy, macro_f1=macro_f1, recall=recall,
                support=SUPPORT.copy(), confusion_matrix=cm)


def run_files(directory, *, img_size=256, completed=5, initial_improved=False,
              trained_improved=True, reference=False, smoke=0):
    config = dict(arch="resnet50", epochs=20 if reference else 5, batch_size=16,
                  img_size=img_size, seed=42, lr=1e-4 if reference else 1e-5,
                  balanced_sampler=True, train_geometry="random_crop",
                  selection="highest validation macro_f1; earliest tie",
                  manifest_sha256="a" * 64, classes=[f"{i}_class" for i in range(9)],
                  smoke_per_class=smoke, train_images=32513, val_images=4070, num_workers=2)
    provenance = dict(init_checkpoint_sha256=SOURCE_SHA256, init_checkpoint_epoch=1,
                      init_checkpoint_img_size=256)
    if not reference:
        config.update(provenance)
    initial = dict(metrics(initial_improved), epoch=0, img_size=img_size, **provenance)
    history = [dict(epoch=epoch, train_loss=.2, train_accuracy=.99,
                    val=metrics(trained_improved)) for epoch in range(1, completed + 1)]
    best_epoch = 1 if reference or (completed and trained_improved and not initial_improved) else 0
    best = metrics(trained_improved if best_epoch else initial_improved)
    if not reference:
        best["epoch"] = best_epoch
    files = dict(config=config, initial_val_metrics=initial, history=history,
                 val_metrics=best, environment=dict(torch="2.11", device="cuda", gpu="T4"))
    if reference:
        del files["initial_val_metrics"]
    directory.mkdir()
    for name, value in files.items():
        (directory / f"{name}.json").write_text(json.dumps(value), encoding="utf-8")
    return directory


def modify(directory, name, change):
    path = directory / f"{name}.json"
    value = json.loads(path.read_text(encoding="utf-8"))
    change(value)
    path.write_text(json.dumps(value), encoding="utf-8")


def test_fixed_epoch_five_is_separate_from_best_including_epoch_zero(monkeypatch, tmp_path):
    comparison = comparison_module(monkeypatch)
    control = run_files(tmp_path / "control")
    candidate = run_files(tmp_path / "candidate", img_size=384, initial_improved=True,
                          trained_improved=False)
    report = comparison.compare_runs(control, candidate)
    assert report["status"] == "full_comparison"
    assert report["control"]["best_epoch"] == 1
    assert report["candidate"]["best_epoch"] == 0
    assert report["candidate"]["completed_epochs"] == 5
    assert report["candidate"]["initial"]["accuracy"] == pytest.approx(4063 / 4070)
    assert report["control"]["initial"]["accuracy"] == pytest.approx(4059 / 4070)
    assert report["comparisons"]["best"]["delta"]["accuracy"] == 0
    fixed = report["comparisons"]["epoch_5"]
    assert fixed["delta"]["accuracy"] == pytest.approx(-4 / 4070)
    assert fixed["per_class"][3]["control"] == pytest.approx(
        dict(support=24, precision=21 / 25, recall=21 / 24, f1=42 / 49))
    assert fixed["per_class"][3]["candidate"]["f1"] == pytest.approx(38 / 49)
    assert len(fixed["per_class"]) == 9
    assert [(r["actual"], r["predicted"], r["control"], r["candidate"], r["delta"])
            for r in fixed["focused_confusions"]] == [(3, 2, 2, 3, 1), (3, 8, 1, 2, 1), (2, 3, 4, 6, 2)]
    assert fixed["confusion_matrix"]["delta"][3][3] == -2


@pytest.mark.parametrize("completed", [0, 3, 4])
def test_partial_training_cannot_claim_fixed_epoch_five(monkeypatch, tmp_path, completed):
    comparison = comparison_module(monkeypatch)
    control = run_files(tmp_path / "control")
    candidate = run_files(tmp_path / "candidate", img_size=384, completed=completed)
    report = comparison.compare_runs(control, candidate)
    assert report["status"] == "incomplete"
    assert report["candidate"]["completed_epochs"] == completed
    assert report["comparisons"]["epoch_5"] is None
    assert any("INCOMPLETE" in note for note in report["limitations"])


@pytest.mark.parametrize("key,value", [
    ("seed", 7), ("lr", 1e-4), ("epochs", 4), ("batch_size", 8),
    ("balanced_sampler", False), ("train_geometry", "full_resize"), ("img_size", 256),
    ("manifest_sha256", "b" * 64), ("classes", [f"{i}_other" for i in range(9)]),
    ("init_checkpoint_sha256", "b" * 64), ("init_checkpoint_epoch", 2),
    ("init_checkpoint_img_size", 384), ("num_workers", 0),
])
def test_nonresolution_configuration_or_source_changes_are_rejected(monkeypatch, tmp_path, key, value):
    comparison = comparison_module(monkeypatch)
    control = run_files(tmp_path / "control")
    candidate = run_files(tmp_path / "candidate", img_size=384)
    modify(candidate, "config", lambda config: config.update({key: value}))
    with pytest.raises(ValueError, match=key):
        comparison.compare_runs(control, candidate)


@pytest.mark.parametrize("value", [None, "", "not-a-checksum"])
def test_matching_but_invalid_source_hashes_are_rejected(monkeypatch, tmp_path, value):
    comparison = comparison_module(monkeypatch)
    control = run_files(tmp_path / "control")
    candidate = run_files(tmp_path / "candidate", img_size=384)
    for directory in (control, candidate):
        modify(directory, "config", lambda config: config.update(init_checkpoint_sha256=value))
    with pytest.raises(ValueError, match="init_checkpoint_sha256"):
        comparison.compare_runs(control, candidate)


@pytest.mark.parametrize("name,change,match", [
    ("history", lambda history: history[-1].update(epoch=4), "epoch"),
    ("val_metrics", lambda value: value.update(epoch=5), "best epoch"),
    ("val_metrics", lambda value: value.update(accuracy=1), "accuracy"),
    ("val_metrics", lambda value: value["support"].__setitem__(3, 25), "support"),
    ("initial_val_metrics", lambda value: value.update(img_size=256), "img_size"),
    ("initial_val_metrics", lambda value: value.update(init_checkpoint_sha256="b" * 64), "init_checkpoint_sha256"),
    ("initial_val_metrics", lambda value: value.update(epoch=1), "epoch"),
])
def test_inconsistent_artifacts_are_rejected(monkeypatch, tmp_path, name, change, match):
    comparison = comparison_module(monkeypatch)
    control = run_files(tmp_path / "control")
    candidate = run_files(tmp_path / "candidate", img_size=384)
    modify(candidate, name, change)
    with pytest.raises(ValueError, match=match):
        comparison.compare_runs(control, candidate)


def test_epoch_zero_wins_an_exact_macro_f1_tie(monkeypatch, tmp_path):
    comparison = comparison_module(monkeypatch)
    control = run_files(tmp_path / "control", initial_improved=True)
    candidate = run_files(tmp_path / "candidate", img_size=384, initial_improved=True)
    report = comparison.compare_runs(control, candidate)
    assert report["control"]["best_epoch"] == report["candidate"]["best_epoch"] == 0
    modify(candidate, "val_metrics", lambda value: value.update(epoch=1))
    with pytest.raises(ValueError, match="best epoch 0"):
        comparison.compare_runs(control, candidate)


def test_reference_is_separate_and_hash_checked_if_checkpoint_is_available(monkeypatch, tmp_path):
    comparison = comparison_module(monkeypatch)
    control = run_files(tmp_path / "control")
    candidate = run_files(tmp_path / "candidate", img_size=384)
    reference = run_files(tmp_path / "reference", reference=True, completed=20,
                          trained_improved=False)
    report = comparison.compare_runs(control, candidate, reference)
    assert report["reference"]["accuracy"] == pytest.approx(4059 / 4070)
    assert report["reference"]["checkpoint_hash_verified"] is False
    (reference / "best_model.pth").write_bytes(SOURCE_BYTES)
    report = comparison.compare_runs(control, candidate, reference)
    assert report["reference"]["checkpoint_hash_verified"] is True
    (reference / "best_model.pth").write_bytes(b"different checkpoint")
    with pytest.raises(ValueError, match="checkpoint.*SHA256"):
        comparison.compare_runs(control, candidate, reference)


@pytest.mark.parametrize("key,value", [
    ("arch", "resnet18"), ("manifest_sha256", "b" * 64),
    ("classes", [f"{i}_other" for i in range(9)]), ("train_geometry", "full_resize"),
    ("img_size", 384),
])
def test_reference_must_match_source_provenance(monkeypatch, tmp_path, key, value):
    comparison = comparison_module(monkeypatch)
    control = run_files(tmp_path / "control")
    candidate = run_files(tmp_path / "candidate", img_size=384)
    reference = run_files(tmp_path / "reference", reference=True, completed=20)
    modify(reference, "config", lambda config: config.update({key: value}))
    with pytest.raises(ValueError, match=key):
        comparison.compare_runs(control, candidate, reference)


def test_smoke_and_environment_caveats_are_visible(monkeypatch, tmp_path):
    comparison = comparison_module(monkeypatch)
    control = run_files(tmp_path / "control", smoke=1)
    candidate = run_files(tmp_path / "candidate", img_size=384, smoke=1)
    modify(candidate, "environment", lambda environment: environment.update(gpu="L4"))
    report = comparison.compare_runs(control, candidate)
    assert report["status"] == "smoke"
    assert report["recorded_environment_matches"] is False
    assert report["environment_differences"] == {"gpu": {"control": "T4", "candidate": "L4"}}


def test_cpu_smoke_can_use_matched_small_models_and_resolutions(monkeypatch, tmp_path):
    comparison = comparison_module(monkeypatch)
    control = run_files(tmp_path / "control", smoke=2)
    candidate = run_files(tmp_path / "candidate", img_size=384, smoke=2)
    for directory, size in ((control, 64), (candidate, 96)):
        modify(directory, "config", lambda config: config.update(
            arch="resnet18", batch_size=9, num_workers=0, img_size=size, init_checkpoint_img_size=64))
        modify(directory, "initial_val_metrics", lambda value: value.update(img_size=size, init_checkpoint_img_size=64))
    report = comparison.compare_runs(control, candidate)
    assert report["status"] == "smoke"
    markdown = comparison.markdown_report(report)
    assert "Control: 64 px; candidate: 96 px" in markdown


def test_cli_writes_full_json_and_markdown_without_loading_models(tmp_path):
    control = run_files(tmp_path / "control")
    candidate = run_files(tmp_path / "candidate", img_size=384, initial_improved=True)
    reference = run_files(tmp_path / "reference", reference=True, completed=20)
    output = tmp_path / "report"
    result = subprocess.run([sys.executable, str(SCRIPT), "--control-dir", str(control),
                             "--candidate-dir", str(candidate), "--reference-dir", str(reference),
                             "--output-dir", str(output)], text=True, encoding="utf-8", capture_output=True)
    assert result.returncode == 0, result.stderr
    report = json.loads((output / "comparison.json").read_text(encoding="utf-8"))
    assert report["status"] == "full_comparison"
    markdown = (output / "comparison.md").read_text(encoding="utf-8")
    assert markdown.strip() == result.stdout.strip()
    for text in ("Best including epoch 0", "Fixed epoch 5", "Original baseline reference",
                 "Precision", "Recall", "F1", "3 -> 2", "4070", "Confusion matrix delta"):
        assert text in markdown
