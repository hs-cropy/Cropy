"""Compare official-split crop/resize runs without loading models or test data.

Usage: python ml/compare_crop_ablation.py --baseline-dir BASELINE \
    --candidate-dir CANDIDATE --output-dir REPORT
"""

import argparse
import json
import math
from pathlib import Path


def metrics_from_confusion(cm):
    """Rows are actual labels; columns are predictions. Undefined rates are zero."""
    if (not isinstance(cm, list) or len(cm) != 9
            or any(not isinstance(row, list) or len(row) != 9 for row in cm)
            or any(type(value) is not int or value < 0 for row in cm for value in row)):
        raise ValueError("confusion_matrix must be a 9 x 9 matrix of nonnegative integers")
    support = [sum(row) for row in cm]
    predicted = [sum(row[i] for row in cm) for i in range(9)]
    total = sum(support)
    if not total:
        raise ValueError("confusion_matrix contains no validation samples")
    precision = [cm[i][i] / predicted[i] if predicted[i] else 0.0 for i in range(9)]
    recall = [cm[i][i] / support[i] if support[i] else 0.0 for i in range(9)]
    f1 = [2 * cm[i][i] / (support[i] + predicted[i]) if support[i] + predicted[i] else 0.0
          for i in range(9)]
    return dict(accuracy=sum(cm[i][i] for i in range(9)) / total,
                macro_f1=sum(f1) / 9, support=support, precision=precision, recall=recall, f1=f1)


def checked_metrics(raw, source):
    if not isinstance(raw, dict):
        raise ValueError(f"{source}: metrics must be an object")
    calculated = metrics_from_confusion(raw.get("confusion_matrix"))
    for key in ("accuracy", "macro_f1", "support", "recall"):
        if key not in raw:
            raise ValueError(f"{source}: missing {key}")
    for key, actual in calculated.items():
        if key not in raw:  # Legacy exports omit precision and F1.
            continue
        recorded = raw[key]
        if isinstance(actual, list):
            valid = (isinstance(recorded, list) and len(recorded) == len(actual)
                     and all(close(x, y) for x, y in zip(recorded, actual)))
        else:
            valid = close(recorded, actual)
        if not valid:
            raise ValueError(f"{source}: {key} disagrees with confusion_matrix")
    return calculated


def close(a, b):
    return (type(a) in (int, float) and math.isfinite(a)
            and math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-12))


def load_run(directory):
    directory = Path(directory)
    artifacts = {}
    for name in ("config", "val_metrics", "history", "environment"):
        path = directory / f"{name}.json"
        try:
            artifacts[name] = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            raise ValueError(f"Cannot read {path}: {error}") from error
    config = artifacts["config"]
    if not isinstance(config, dict):
        raise ValueError(f"{directory}: config must be an object")
    config = dict(config)
    config.setdefault("train_geometry", "random_crop")
    required = {"arch", "epochs", "batch_size", "img_size", "seed", "lr", "balanced_sampler",
                "selection", "manifest_sha256", "classes", "smoke_per_class", "train_images",
                "val_images", "num_workers"}
    missing = sorted(required - config.keys())
    if missing:
        raise ValueError(f"{directory}: missing config fields: {', '.join(missing)}")
    classes = config["classes"]
    if (not isinstance(classes, list) or len(classes) != 9
            or any(not isinstance(name, str) or not name for name in classes)
            or len(set(classes)) != 9):
        raise ValueError(f"{directory}: classes must contain nine unique names in label order")
    if not isinstance(config["manifest_sha256"], str) or not config["manifest_sha256"]:
        raise ValueError(f"{directory}: manifest_sha256 is missing")
    if type(config["epochs"]) is not int or config["epochs"] < 1:
        raise ValueError(f"{directory}: epochs must be positive")
    if type(config["smoke_per_class"]) is not int or config["smoke_per_class"] < 0:
        raise ValueError(f"{directory}: smoke_per_class must be nonnegative")
    if config["selection"] != "highest validation macro_f1; earliest tie":
        raise ValueError(f"{directory}: selection must be highest validation macro_f1; earliest tie")
    if not isinstance(artifacts["environment"], dict) or not artifacts["environment"]:
        raise ValueError(f"{directory}: environment must be a nonempty object")
    exported = checked_metrics(artifacts["val_metrics"], str(directory / "val_metrics.json"))
    if sum(exported["support"]) != config["val_images"]:
        raise ValueError(f"{directory}: validation support disagrees with config val_images")
    history = artifacts["history"]
    if not isinstance(history, list) or not history or len(history) > config["epochs"]:
        raise ValueError(f"{directory}: history must contain 1..epochs completed records")
    best_epoch, best_score, best_cm = None, -1.0, None
    for epoch, record in enumerate(history, 1):
        if (not isinstance(record, dict) or type(record.get("epoch")) is not int
                or record["epoch"] != epoch):
            raise ValueError(f"{directory}: history epoch numbers must be consecutive from 1")
        metrics = checked_metrics(record.get("val"), f"{directory}: epoch {epoch}")
        if metrics["support"] != exported["support"]:
            raise ValueError(f"{directory}: validation support changes at epoch {epoch}")
        # Match the trainer's exact > comparison and earliest-tie policy.
        score = record["val"]["macro_f1"]
        if score > best_score:
            best_epoch, best_score, best_cm = epoch, score, record["val"]["confusion_matrix"]
    if artifacts["val_metrics"]["confusion_matrix"] != best_cm:
        raise ValueError(f"{directory}: val_metrics does not match the earliest best epoch {best_epoch}")
    return dict(directory=str(directory), config=config, environment=artifacts["environment"],
                completed_epochs=len(history), best_epoch=best_epoch,
                confusion_matrix=artifacts["val_metrics"]["confusion_matrix"], **exported)


def compare_runs(baseline_dir, candidate_dir):
    baseline, candidate = load_run(baseline_dir), load_run(candidate_dir)
    before, after = baseline["config"], candidate["config"]
    if before["train_geometry"] != "random_crop" or after["train_geometry"] != "full_resize":
        raise ValueError("train_geometry must be random_crop in baseline and full_resize in candidate")
    differences = sorted(key for key in before.keys() | after.keys()
                         if key != "train_geometry" and (key not in before or key not in after
                                                         or before[key] != after[key]))
    if differences:
        raise ValueError("Configuration/data mismatch: " + ", ".join(differences))
    if baseline["support"] != candidate["support"]:
        raise ValueError("Validation support differs between runs")
    environment_differences = {
        key: dict(baseline=baseline["environment"].get(key), candidate=candidate["environment"].get(key))
        for key in sorted(baseline["environment"].keys() | candidate["environment"].keys())
        if (key not in baseline["environment"] or key not in candidate["environment"]
            or baseline["environment"][key] != candidate["environment"][key])
    }
    limitations = ["This is one validation split and seed; improvement is not evidence of generalization to new data.",
                   "Only recorded environment fields are compared; matching metadata does not prove identical software or hardware."]
    status = "full_comparison"
    if before["smoke_per_class"]:
        status = "smoke"
        limitations.insert(0, "SMOKE RUN: pipeline check only; do not interpret metrics as full-run performance.")
    elif (before["epochs"] != 20 or baseline["completed_epochs"] != 20
          or candidate["completed_epochs"] != 20):
        status = "incomplete"
        limitations.insert(0, "INCOMPLETE: both runs must finish all 20 planned epochs before comparing full-run performance.")
    if not before["smoke_per_class"] and (before["train_images"], before["val_images"]) != (32513, 4070):
        raise ValueError("Non-smoke runs must use the official 32513 train / 4070 validation images")
    if environment_differences:
        limitations.append("Recorded environment differs: this is not a strictly isolated geometry comparison.")
    if baseline["support"][3]:
        limitations.append(f"Class 3 validation support is {baseline['support'][3]}; one image changes recall by "
                           f"{100 / baseline['support'][3]:.2f} percentage points.")
    per_class = []
    for index, name in enumerate(before["classes"]):
        values = {label: {metric: run[metric][index] for metric in ("support", "precision", "recall", "f1")}
                  for label, run in (("baseline", baseline), ("candidate", candidate))}
        values["delta"] = {key: values["candidate"][key] - values["baseline"][key]
                           for key in values["baseline"]}
        per_class.append(dict(index=index, name=name, **values))
    baseline_cm, candidate_cm = baseline["confusion_matrix"], candidate["confusion_matrix"]
    delta_cm = [[candidate_cm[i][j] - baseline_cm[i][j] for j in range(9)] for i in range(9)]
    focused = [dict(actual=i, predicted=j, actual_class=before["classes"][i],
                    predicted_class=before["classes"][j], baseline=baseline_cm[i][j],
                    candidate=candidate_cm[i][j], delta=delta_cm[i][j]) for i, j in ((3, 2), (3, 8), (2, 3))]
    return dict(status=status, configuration_matches_except_geometry=True,
                recorded_environment_matches=not environment_differences,
                environment_differences=environment_differences, baseline=baseline, candidate=candidate,
                delta={key: candidate[key] - baseline[key] for key in ("accuracy", "macro_f1")},
                per_class=per_class, focused_confusions=focused,
                confusion_matrix=dict(baseline=baseline_cm, candidate=candidate_cm, delta=delta_cm),
                limitations=limitations)


def markdown_report(report):
    lines = ["# Crop geometry comparison", "", f"Status: **{report['status']}**", "",
             "Delta is candidate minus baseline. Metric deltas are percentage points (pp).", "",
             "| Run | Geometry | Completed / planned epochs | Best epoch | Accuracy | Macro F1 |",
             "| --- | --- | --- | --- | --- | --- |"]
    for label in ("baseline", "candidate"):
        run = report[label]
        lines.append(f"| {label} | {run['config']['train_geometry']} | {run['completed_epochs']} / "
                     f"{run['config']['epochs']} | {run['best_epoch']} | {run['accuracy']:.4%} | {run['macro_f1']:.4%} |")
    lines += [f"| Delta | | | | {report['delta']['accuracy'] * 100:+.4f} pp | "
              f"{report['delta']['macro_f1'] * 100:+.4f} pp |", "", "## Per-class metrics", "",
              "| Class | Run | Support | Precision | Recall | F1 |", "| --- | --- | --- | --- | --- | --- |"]
    for row in report["per_class"]:
        name = row["name"].replace("|", "\\|").replace("\n", " ")
        for label in ("baseline", "candidate", "delta"):
            values = row[label]
            rates = [f"{values[key] * 100:+.4f} pp" if label == "delta" else f"{values[key]:.4%}"
                     for key in ("precision", "recall", "f1")]
            lines.append(f"| {name} | {label} | {values['support']} | " + " | ".join(rates) + " |")
    lines += ["", "## Focused confusions", "", "| Actual -> predicted | Baseline | Candidate | Delta |",
              "| --- | --- | --- | --- |"]
    for row in report["focused_confusions"]:
        lines.append(f"| {row['actual']} -> {row['predicted']} | {row['baseline']} | {row['candidate']} | {row['delta']:+d} |")
    for label in ("baseline", "candidate", "delta"):
        lines += ["", f"## Confusion matrix {label}", "", "Rows: actual class; columns: predicted class.", "",
                  "| Actual / predicted | " + " | ".join(str(i) for i in range(9)) + " |",
                  "| --- | " + " | ".join(["---"] * 9) + " |"]
        for index, row in enumerate(report["confusion_matrix"][label]):
            lines.append(f"| {index} | " + " | ".join(str(value) for value in row) + " |")
    lines += ["", "## Recorded environment", "",
              f"Recorded fields match: {report['recorded_environment_matches']}", "", "```json",
              json.dumps({label: report[label]["environment"] for label in ("baseline", "candidate")}, indent=2),
              "```", "", "## Limitations", ""]
    lines.extend(f"- {note}" for note in report["limitations"])
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-dir", type=Path, required=True)
    parser.add_argument("--candidate-dir", type=Path, required=True)
    parser.add_argument("--output-dir", "--output", dest="output_dir", type=Path, required=True)
    args = parser.parse_args()
    try:
        report = compare_runs(args.baseline_dir, args.candidate_dir)
    except ValueError as error:
        parser.error(str(error))
    markdown = markdown_report(report)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "comparison.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (args.output_dir / "comparison.md").write_text(markdown, encoding="utf-8")
    print(markdown)


if __name__ == "__main__":
    main()
