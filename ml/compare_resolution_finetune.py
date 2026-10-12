"""Compare paired 256/384 fine-tunes from JSON artifacts, without loading models.

python ml/compare_resolution_finetune.py --control-dir CONTROL256 \
    --candidate-dir CANDIDATE384 --reference-dir ORIGINAL --output-dir REPORT
"""

import argparse
import hashlib
import json
import re
from pathlib import Path

try:
    from .compare_crop_ablation import checked_metrics, load_run as load_reference
except ImportError:  # Direct script invocation.
    from compare_crop_ablation import checked_metrics, load_run as load_reference


PROVENANCE = ("init_checkpoint_sha256", "init_checkpoint_epoch", "init_checkpoint_img_size")
SELECTION = "highest validation macro_f1; earliest tie"


def read_json(directory, name):
    path = Path(directory) / f"{name}.json"
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise ValueError(f"Cannot read {path}: {error}") from error


def snapshot(raw, source, epoch):
    return dict(epoch=epoch, confusion_matrix=raw.get("confusion_matrix") if isinstance(raw, dict) else None,
                **checked_metrics(raw, source))


def load_run(directory):
    """Validate selection against independently measured epoch 0 and completed epochs."""
    directory = Path(directory)
    config = read_json(directory, "config")
    if not isinstance(config, dict):
        raise ValueError(f"{directory}: config must be an object")
    required = {"arch", "epochs", "batch_size", "img_size", "seed", "lr", "balanced_sampler",
                "train_geometry", "selection", "manifest_sha256", "classes", "smoke_per_class",
                "train_images", "val_images", "num_workers", *PROVENANCE}
    missing = sorted(required - config.keys())
    if missing:
        raise ValueError(f"{directory}: missing config fields: {', '.join(missing)}")
    expected = dict(epochs=5, seed=42, lr=1e-5, balanced_sampler=True,
                    train_geometry="random_crop", selection=SELECTION)
    if not config["smoke_per_class"]:
        expected.update(arch="resnet50", batch_size=16, init_checkpoint_img_size=256)
    for key, value in expected.items():
        if type(config[key]) is not type(value) or config[key] != value:
            raise ValueError(f"{directory}: {key} must be {value!r}")
    for key in ("manifest_sha256", "init_checkpoint_sha256"):
        if not isinstance(config[key], str) or not re.fullmatch(r"[0-9a-f]{64}", config[key]):
            raise ValueError(f"{directory}: {key} must be a SHA256 hex digest")
    for key, minimum in (("init_checkpoint_epoch", 1), ("init_checkpoint_img_size", 1),
                         ("img_size", 1), ("batch_size", 2), ("smoke_per_class", 0),
                         ("num_workers", 0), ("train_images", 1), ("val_images", 1)):
        if type(config[key]) is not int or config[key] < minimum:
            raise ValueError(f"{directory}: {key} must be an integer >= {minimum}")
    classes = config["classes"]
    if (not isinstance(classes, list) or len(classes) != 9
            or any(not isinstance(name, str) or not name for name in classes) or len(set(classes)) != 9):
        raise ValueError(f"{directory}: classes must contain nine unique names in label order")
    if not config["smoke_per_class"] and (config["train_images"], config["val_images"]) != (32513, 4070):
        raise ValueError(f"{directory}: non-smoke runs require 32513 train_images / 4070 val_images")
    environment = read_json(directory, "environment")
    if not isinstance(environment, dict) or not environment:
        raise ValueError(f"{directory}: environment must be a nonempty object")

    initial_raw = read_json(directory, "initial_val_metrics")
    initial = snapshot(initial_raw, f"{directory}: epoch 0", 0)
    for key, value in dict(epoch=0, img_size=config["img_size"],
                           **{key: config[key] for key in PROVENANCE}).items():
        if type(initial_raw.get(key)) is not type(value) or initial_raw[key] != value:
            raise ValueError(f"{directory}: initial_val_metrics {key} disagrees with run provenance")
    if sum(initial["support"]) != config["val_images"]:
        raise ValueError(f"{directory}: validation support disagrees with config val_images")
    history = read_json(directory, "history")
    if not isinstance(history, list) or len(history) > config["epochs"]:
        raise ValueError(f"{directory}: history must contain 0..epochs completed records")
    best, best_score, last = initial, initial_raw["macro_f1"], initial
    for epoch, record in enumerate(history, 1):
        if (not isinstance(record, dict) or type(record.get("epoch")) is not int
                or record["epoch"] != epoch):
            raise ValueError(f"{directory}: history epoch numbers must be consecutive from 1")
        last = snapshot(record.get("val"), f"{directory}: epoch {epoch}", epoch)
        if last["support"] != initial["support"]:
            raise ValueError(f"{directory}: validation support changes at epoch {epoch}")
        # The trainer compares its recorded score with strict >, preserving the earliest tie.
        if record["val"]["macro_f1"] > best_score:
            best, best_score = last, record["val"]["macro_f1"]
    exported_raw = read_json(directory, "val_metrics")
    exported = snapshot(exported_raw, f"{directory}: val_metrics", best["epoch"])
    if (type(exported_raw.get("epoch")) is not int or exported_raw["epoch"] != best["epoch"]
            or exported["confusion_matrix"] != best["confusion_matrix"]):
        raise ValueError(f"{directory}: val_metrics does not match the earliest best epoch {best['epoch']}")
    return dict(directory=str(directory), config=config, environment=environment,
                completed_epochs=len(history), best_epoch=best["epoch"], initial=initial, best=best,
                epoch_5=last if len(history) == 5 else None)


def metric_comparison(control, candidate, classes):
    per_class = []
    for index, name in enumerate(classes):
        row = {label: {metric: values[metric][index] for metric in ("support", "precision", "recall", "f1")}
               for label, values in (("control", control), ("candidate", candidate))}
        row["delta"] = {key: row["candidate"][key] - row["control"][key] for key in row["control"]}
        per_class.append(dict(index=index, name=name, **row))
    before, after = control["confusion_matrix"], candidate["confusion_matrix"]
    delta = [[after[i][j] - before[i][j] for j in range(9)] for i in range(9)]
    focused = [dict(actual=i, predicted=j, actual_class=classes[i], predicted_class=classes[j],
                    control=before[i][j], candidate=after[i][j], delta=delta[i][j])
               for i, j in ((3, 2), (3, 8), (2, 3))]
    return dict(control=control, candidate=candidate,
                delta={key: candidate[key] - control[key] for key in ("accuracy", "macro_f1")},
                per_class=per_class, focused_confusions=focused,
                confusion_matrix=dict(control=before, candidate=after, delta=delta))


def checked_reference(directory, control):
    reference = load_reference(directory)
    config, source = reference["config"], control["config"]
    for key in ("arch", "classes", "manifest_sha256", "train_geometry", "smoke_per_class",
                "train_images", "val_images"):
        if config[key] != source[key]:
            raise ValueError(f"Reference source configuration mismatch: {key}")
    if config["img_size"] != source["init_checkpoint_img_size"]:
        raise ValueError("Reference source configuration mismatch: img_size")
    if reference["best_epoch"] != source["init_checkpoint_epoch"]:
        raise ValueError("Reference best epoch disagrees with init_checkpoint_epoch")
    if reference["support"] != control["initial"]["support"]:
        raise ValueError("Reference validation support differs from paired runs")
    checkpoint = Path(directory) / "best_model.pth"
    reference["checkpoint_hash_verified"] = False
    if checkpoint.exists():
        try:
            with checkpoint.open("rb") as stream:
                digest = hashlib.file_digest(stream, "sha256").hexdigest()
        except OSError as error:
            raise ValueError(f"Cannot read reference checkpoint {checkpoint}: {error}") from error
        if digest != source["init_checkpoint_sha256"]:
            raise ValueError("Reference checkpoint SHA256 disagrees with init_checkpoint_sha256")
        reference["checkpoint_hash_verified"] = True
    return reference


def compare_runs(control_dir, candidate_dir, reference_dir=None):
    control, candidate = load_run(control_dir), load_run(candidate_dir)
    before, after = control["config"], candidate["config"]
    if before["smoke_per_class"]:
        if before["img_size"] >= after["img_size"]:
            raise ValueError("Smoke img_size must be larger in candidate than control")
    elif before["img_size"] != 256 or after["img_size"] != 384:
        raise ValueError("img_size must be 256 in control and 384 in candidate")
    differences = sorted(key for key in before.keys() | after.keys()
                         if key != "img_size" and (key not in before or key not in after or before[key] != after[key]))
    if differences:
        raise ValueError("Configuration/data mismatch: " + ", ".join(differences))
    if control["initial"]["support"] != candidate["initial"]["support"]:
        raise ValueError("Validation support differs between runs")
    environment_differences = {
        key: dict(control=control["environment"].get(key), candidate=candidate["environment"].get(key))
        for key in sorted(control["environment"].keys() | candidate["environment"].keys())
        if (key not in control["environment"] or key not in candidate["environment"]
            or control["environment"][key] != candidate["environment"][key])}
    limitations = [
        "This is one validation split and seed; improvement is not evidence of generalization to new data.",
        "Best includes epoch 0 evaluated independently at each resolution; epoch 0 can remain best after five training epochs.",
        "Best checkpoints can come from different epochs. Fixed epoch 5 compares equal completed training duration.",
        "The original baseline is a source reference; only the paired 256/384 fine-tunes isolate resolution.",
        "Only recorded environment fields are compared; matching metadata does not prove identical software or hardware."]
    status = "full_comparison"
    if before["smoke_per_class"]:
        status = "smoke"
        limitations.insert(0, "SMOKE RUN: pipeline check only; do not interpret as full-run performance.")
    elif control["completed_epochs"] != 5 or candidate["completed_epochs"] != 5:
        status = "incomplete"
        limitations.insert(0, "INCOMPLETE: both runs must finish all five planned epochs; fixed epoch 5 is unavailable.")
    if environment_differences:
        limitations.append("Recorded environment differs: this is not a strictly isolated resolution comparison.")
    if control["initial"]["support"][3]:
        support = control["initial"]["support"][3]
        limitations.append(f"Class 3 validation support is {support}; one image changes recall by {100 / support:.2f} percentage points.")
    reference = checked_reference(reference_dir, control) if reference_dir is not None else None
    if reference is None or not reference["checkpoint_hash_verified"]:
        limitations.append("Both paired runs record the same source SHA256; the original checkpoint file was not available for independent hash verification.")
    fixed = None
    if control["epoch_5"] is not None and candidate["epoch_5"] is not None:
        fixed = metric_comparison(control["epoch_5"], candidate["epoch_5"], before["classes"])
    return dict(status=status, configuration_matches_except_img_size=True,
                recorded_environment_matches=not environment_differences,
                environment_differences=environment_differences, control=control, candidate=candidate,
                reference=reference,
                comparisons=dict(best=metric_comparison(control["best"], candidate["best"], before["classes"]),
                                 epoch_5=fixed), limitations=limitations)


def matrix_lines(label, matrix):
    lines = ["", f"### Confusion matrix {label}", "", "Rows: actual class; columns: predicted class.", "",
             "| Actual / predicted | " + " | ".join(str(i) for i in range(9)) + " |",
             "| --- | " + " | ".join(["---"] * 9) + " |"]
    lines.extend(f"| {i} | " + " | ".join(str(value) for value in row) + " |" for i, row in enumerate(matrix))
    return lines


def comparison_lines(title, comparison):
    lines = ["", f"## {title}", ""]
    if comparison is None:
        return lines + ["Unavailable: both runs must complete epoch 5."]
    lines += ["| Run | Epoch | Validation images | Accuracy | Macro F1 |", "| --- | --- | --- | --- | --- |"]
    for label in ("control", "candidate"):
        values = comparison[label]
        lines.append(f"| {label} | {values['epoch']} | {sum(values['support'])} | {values['accuracy']:.4%} | {values['macro_f1']:.4%} |")
    lines += [f"| Delta | | | {comparison['delta']['accuracy'] * 100:+.4f} pp | {comparison['delta']['macro_f1'] * 100:+.4f} pp |",
              "", "### Per-class metrics", "", "| Class | Run | Support | Precision | Recall | F1 |",
              "| --- | --- | --- | --- | --- | --- |"]
    for row in comparison["per_class"]:
        name = row["name"].replace("|", "\\|").replace("\n", " ")
        for label in ("control", "candidate", "delta"):
            values = row[label]
            rates = [f"{values[key] * 100:+.4f} pp" if label == "delta" else f"{values[key]:.4%}"
                     for key in ("precision", "recall", "f1")]
            lines.append(f"| {name} | {label} | {values['support']} | " + " | ".join(rates) + " |")
    lines += ["", "### Focused confusions", "", "| Actual -> predicted | Control | Candidate | Delta |",
              "| --- | --- | --- | --- |"]
    for row in comparison["focused_confusions"]:
        lines.append(f"| {row['actual']} -> {row['predicted']} | {row['control']} | {row['candidate']} | {row['delta']:+d} |")
    for label, matrix in comparison["confusion_matrix"].items():
        lines += matrix_lines(label, matrix)
    return lines


def markdown_report(report):
    lines = ["# Resolution fine-tune comparison", "", f"Status: **{report['status']}**", "",
             f"Control: {report['control']['config']['img_size']} px; candidate: {report['candidate']['config']['img_size']} px. "
             "Delta is candidate minus control; metric deltas are percentage points (pp).", "",
             "| Run | Completed / planned epochs | Best epoch | Initial accuracy | Initial Macro F1 |",
             "| --- | --- | --- | --- | --- |"]
    for label in ("control", "candidate"):
        run = report[label]
        lines.append(f"| {label} | {run['completed_epochs']} / {run['config']['epochs']} | {run['best_epoch']} | "
                     f"{run['initial']['accuracy']:.4%} | {run['initial']['macro_f1']:.4%} |")
    lines += comparison_lines("Best including epoch 0", report["comparisons"]["best"])
    lines += comparison_lines("Fixed epoch 5", report["comparisons"]["epoch_5"])
    lines += ["", "## Original baseline reference", ""]
    reference = report["reference"]
    if reference is None:
        lines.append("Not supplied.")
    else:
        lines += [f"Original {reference['config']['img_size']} px best epoch: {reference['best_epoch']}; "
                  f"validation images: {sum(reference['support'])}; accuracy: {reference['accuracy']:.4%}; "
                  f"Macro F1: {reference['macro_f1']:.4%}.", "",
                  f"Source checkpoint SHA256 independently verified: {reference['checkpoint_hash_verified']}", "",
                  "| Class | Support | Precision | Recall | F1 |", "| --- | --- | --- | --- | --- |"]
        for i, name in enumerate(reference["config"]["classes"]):
            name = name.replace("|", "\\|").replace("\n", " ")
            lines.append(f"| {name} | {reference['support'][i]} | {reference['precision'][i]:.4%} | "
                         f"{reference['recall'][i]:.4%} | {reference['f1'][i]:.4%} |")
        lines += ["", "| Actual -> predicted | Count |", "| --- | --- |"]
        lines.extend(f"| {i} -> {j} | {reference['confusion_matrix'][i][j]} |" for i, j in ((3, 2), (3, 8), (2, 3)))
        lines += matrix_lines("original reference", reference["confusion_matrix"])
    lines += ["", "## Run provenance", "", "```json",
              json.dumps({label: report[label]["config"] for label in ("control", "candidate")}, ensure_ascii=False, indent=2),
              "```", "", "## Recorded environment", "",
              f"Recorded fields match: {report['recorded_environment_matches']}", "", "```json",
              json.dumps({label: report[label]["environment"] for label in ("control", "candidate")}, indent=2),
              "```", "", "## Limitations", ""]
    lines.extend(f"- {note}" for note in report["limitations"])
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--control-dir", "--baseline-dir", dest="control_dir", type=Path, required=True)
    parser.add_argument("--candidate-dir", type=Path, required=True)
    parser.add_argument("--reference-dir", type=Path)
    parser.add_argument("--output-dir", "--output", dest="output_dir", type=Path, required=True)
    args = parser.parse_args()
    try:
        report = compare_runs(args.control_dir, args.candidate_dir, args.reference_dir)
    except ValueError as error:
        parser.error(str(error))
    markdown = markdown_report(report)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "comparison.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (args.output_dir / "comparison.md").write_text(markdown, encoding="utf-8")
    print(markdown)


if __name__ == "__main__":
    main()
