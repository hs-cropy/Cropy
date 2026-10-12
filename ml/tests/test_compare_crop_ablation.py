"""Exercise comparison math and guards with hand-checked run artifacts."""

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest


SCRIPT = Path(__file__).resolve().parents[1] / "compare_crop_ablation.py"


@pytest.fixture
def comparison():
    assert SCRIPT.exists(), "The comparison CLI has not been implemented"
    spec = importlib.util.spec_from_file_location("compare_crop_ablation", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_files(directory, *, candidate=False, epochs=20, smoke=0, completed=20):
    # Full validation total is 4070. Only class 2/3/8 have errors.
    cm = [[0] * 9 for _ in range(9)]
    for i, count in enumerate([1000, 1000, 100, 24, 500, 500, 400, 446, 100]):
        cm[i][i] = count
    if candidate:
        cm[2][2], cm[2][3] = 96, 4
        cm[3][2], cm[3][3], cm[3][8] = 2, 21, 1
        accuracy, macro_f1 = 4063 / 4070, (6 + 192 / 198 + 42 / 49 + 200 / 201) / 9
        recall = [1, 1, .96, .875, 1, 1, 1, 1, 1]
    else:
        cm[2][2], cm[2][3] = 94, 6
        cm[3][2], cm[3][3], cm[3][8] = 3, 19, 2
        accuracy, macro_f1 = 4059 / 4070, (6 + 188 / 197 + 38 / 49 + 200 / 202) / 9
        recall = [1, 1, .94, 19 / 24, 1, 1, 1, 1, 1]
    metrics = dict(accuracy=accuracy, macro_f1=macro_f1, recall=recall,
                   support=[1000, 1000, 100, 24, 500, 500, 400, 446, 100], confusion_matrix=cm)
    config = dict(arch="resnet50", epochs=epochs, batch_size=16, img_size=256,
                  seed=42, lr=.0001, balanced_sampler=True,
                  selection="highest validation macro_f1; earliest tie",
                  manifest_sha256="a" * 64, classes=[f"{i}_class" for i in range(9)],
                  smoke_per_class=smoke, train_images=32513, val_images=4070, num_workers=2)
    if candidate:
        config["train_geometry"] = "full_resize"
    files = {
        "config.json": config,
        "val_metrics.json": metrics,
        "history.json": [dict(epoch=i, train_loss=.2, train_accuracy=.99, val=metrics)
                         for i in range(1, completed + 1)],
        "environment.json": dict(torch="2.11.0+cu130", device="cuda", gpu="Tesla T4"),
    }
    directory.mkdir()
    for filename, value in files.items():
        (directory / filename).write_text(json.dumps(value), encoding="utf-8")
    return directory


def modify(directory, filename, change):
    path = directory / filename
    value = json.loads(path.read_text(encoding="utf-8"))
    change(value)
    path.write_text(json.dumps(value), encoding="utf-8")


def test_hand_calculated_metrics_and_directed_errors(comparison, tmp_path):
    baseline = run_files(tmp_path / "baseline")
    candidate = run_files(tmp_path / "candidate", candidate=True)
    report = comparison.compare_runs(baseline, candidate)
    assert report["status"] == "full_comparison"
    assert report["baseline"]["best_epoch"] == 1  # Earliest tied maximum.
    assert report["baseline"]["accuracy"] == pytest.approx(4059 / 4070)
    assert report["delta"]["accuracy"] == pytest.approx(4 / 4070)
    row = report["per_class"][3]
    assert row["baseline"] == pytest.approx(dict(support=24, precision=19 / 25,
                                                recall=19 / 24, f1=38 / 49))
    assert row["candidate"]["f1"] == pytest.approx(42 / 49)
    assert row["delta"]["recall"] == pytest.approx(2 / 24)
    assert [(r["actual"], r["predicted"], r["baseline"], r["candidate"], r["delta"])
            for r in report["focused_confusions"]] == [(3, 2, 3, 2, -1), (3, 8, 2, 1, -1), (2, 3, 6, 4, -2)]
    assert report["confusion_matrix"]["delta"][3][3] == 2
    assert len(report["per_class"]) == 9


@pytest.mark.parametrize("key,value", [("seed", 7), ("manifest_sha256", "b" * 64),
                                       ("classes", [f"different_{i}" for i in range(9)])])
def test_config_or_data_mismatch_is_rejected(comparison, tmp_path, key, value):
    baseline = run_files(tmp_path / "baseline")
    candidate = run_files(tmp_path / "candidate", candidate=True)
    modify(candidate, "config.json", lambda config: config.update({key: value}))
    with pytest.raises(ValueError, match=key):
        comparison.compare_runs(baseline, candidate)


@pytest.mark.parametrize("geometry", ["random_crop", "padding"])
def test_candidate_must_be_the_requested_geometry(comparison, tmp_path, geometry):
    baseline = run_files(tmp_path / "baseline")
    candidate = run_files(tmp_path / "candidate", candidate=True)
    modify(candidate, "config.json", lambda config: config.update(train_geometry=geometry))
    with pytest.raises(ValueError, match="train_geometry"):
        comparison.compare_runs(baseline, candidate)


@pytest.mark.parametrize("kwargs,status", [({"completed": 3}, "incomplete"),
                                            ({"epochs": 2, "completed": 2}, "incomplete"),
                                            ({"smoke": 2}, "smoke")])
def test_short_or_smoke_runs_are_not_full_comparisons(comparison, tmp_path, kwargs, status):
    baseline = run_files(tmp_path / "baseline", **kwargs)
    candidate = run_files(tmp_path / "candidate", candidate=True, **kwargs)
    report = comparison.compare_runs(baseline, candidate)
    assert report["status"] == status
    assert report["limitations"]


def test_environment_difference_is_visible(comparison, tmp_path):
    baseline = run_files(tmp_path / "baseline")
    candidate = run_files(tmp_path / "candidate", candidate=True)
    modify(candidate, "environment.json", lambda environment: environment.update(gpu="L4"))
    report = comparison.compare_runs(baseline, candidate)
    assert report["recorded_environment_matches"] is False
    assert report["environment_differences"] == {"gpu": {"baseline": "Tesla T4", "candidate": "L4"}}
    assert any("environment differs" in note for note in report["limitations"])


@pytest.mark.parametrize("filename,change,match", [
    ("history.json", lambda h: h[-1].update(epoch=19), "epoch"),
    ("val_metrics.json", lambda m: m.update(accuracy=1), "accuracy"),
    ("val_metrics.json", lambda m: m["support"].__setitem__(3, 25), "support"),
    ("val_metrics.json", lambda m: m["confusion_matrix"][3].__setitem__(2, -1), "confusion_matrix"),
])
def test_inconsistent_artifacts_fail_instead_of_reporting_results(comparison, tmp_path, filename, change, match):
    baseline = run_files(tmp_path / "baseline")
    candidate = run_files(tmp_path / "candidate", candidate=True)
    modify(candidate, filename, change)
    with pytest.raises(ValueError, match=match):
        comparison.compare_runs(baseline, candidate)


def test_export_must_match_the_earliest_best_epoch(comparison, tmp_path):
    baseline = run_files(tmp_path / "baseline")
    candidate = run_files(tmp_path / "candidate", candidate=True)
    wrong = json.loads((baseline / "val_metrics.json").read_text(encoding="utf-8"))
    (candidate / "val_metrics.json").write_text(json.dumps(wrong), encoding="utf-8")
    with pytest.raises(ValueError, match="best epoch"):
        comparison.compare_runs(baseline, candidate)


def test_cli_writes_json_and_markdown_and_prints_report(comparison, tmp_path):
    baseline = run_files(tmp_path / "baseline")
    candidate = run_files(tmp_path / "candidate", candidate=True)
    output = tmp_path / "report"
    result = subprocess.run([sys.executable, str(SCRIPT), "--baseline-dir", str(baseline),
                             "--candidate-dir", str(candidate), "--output-dir", str(output)],
                            text=True, encoding="utf-8", capture_output=True)
    assert result.returncode == 0, result.stderr
    assert json.loads((output / "comparison.json").read_text(encoding="utf-8"))["status"] == "full_comparison"
    markdown = (output / "comparison.md").read_text(encoding="utf-8")
    assert markdown.strip() == result.stdout.strip()
    assert "3_class" in markdown and "Precision" in markdown and "Confusion matrix delta" in markdown
