"""CPU integration checks for fine-tuning initialization and epoch-boundary resume."""
import hashlib
import json
import shutil
import sys
from pathlib import Path

import pytest
import torch
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import train_full_colab as trainer


class TinyClassifier(torch.nn.Module):
    """Replace the expensive ResNet only; use real data, optimizer and checkpoints."""
    def __init__(self):
        super().__init__()
        self.features = torch.nn.Conv2d(3, 4, 1)
        self.fc = torch.nn.Linear(4, 9)

    def forward(self, images):
        return self.fc(self.features(images).mean((2, 3)))


@pytest.fixture
def experiment(tmp_path, monkeypatch):
    data = tmp_path / "dataset" / "images"
    classes = [f"class_{i}" for i in range(9)]
    for split in ("train", "val"):
        for index, name in enumerate(classes):
            folder = data / split / name
            folder.mkdir(parents=True)
            for number in range(2):
                Image.new("RGB", (19, 17), (20 * index, 30 * number, 150)).save(folder / f"{number}.png")
    (data.parent / "manifest.csv").write_text("fixed official manifest\n", encoding="utf-8")
    config = dict(arch="resnet50", epochs=20, batch_size=16, img_size=256,
                  seed=42, lr=1e-4, balanced_sampler=True,
                  selection="highest validation macro_f1; earliest tie",
                  manifest_sha256=hashlib.sha256((data.parent / "manifest.csv").read_bytes()).hexdigest(),
                  classes=classes, smoke_per_class=2, train_images=18, val_images=18, num_workers=0)
    model = TinyClassifier()
    # Nonzero source Adam moments must never leak into a fresh fine-tune.
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-4)
    model(torch.ones(2, 3, 8, 8)).sum().backward()
    optimizer.step()
    source_dir = tmp_path / "original"
    source_dir.mkdir()
    source = source_dir / "best_model.pth"
    torch.save(dict(model_state_dict=model.state_dict(), arch="resnet50", classes=classes,
                    num_classes=9, img_size=256, epoch=3, config=config,
                    optimizer=optimizer.state_dict(), history=[{"epoch": 3}]), source)

    def build(*, weights):
        # Any pretrained weight request would access the network in Colab.
        assert weights is None, "fine-tuning/resume must not request ImageNet weights"
        return TinyClassifier()

    monkeypatch.setattr(trainer.models, "resnet50", build)
    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)

    def run(output, *extra, source_path=source, lr="1e-5"):
        args = ["train_full_colab.py", "--data-dir", str(data), "--output-dir", str(output),
                "--epochs", "3", "--batch-size", "16", "--num-workers", "0", "--img-size", "32",
                "--smoke-per-class", "2", "--allow-cpu"]
        if source_path is not None:
            args += ["--init-checkpoint", str(source_path)]
        if lr is not None:
            args += ["--lr", lr]
        monkeypatch.setattr(sys, "argv", args + list(extra))
        trainer.main()

    return tmp_path, source, run


def load(path):
    return torch.load(path, map_location="cpu", weights_only=True)


def assert_same_weights(actual, expected):
    assert actual.keys() == expected.keys()
    assert all(torch.equal(actual[key], expected[key]) for key in actual)


def test_initialization_keeps_all_source_weights_and_resets_training_state(experiment, monkeypatch):
    root, source, run = experiment
    before = source.read_bytes()
    output = root / "finetune"
    real_train_epoch = trainer.train_epoch

    def interrupt_before_training(*args):
        raise KeyboardInterrupt

    monkeypatch.setattr(trainer, "train_epoch", interrupt_before_training)
    with pytest.raises(KeyboardInterrupt):
        run(output)
    initial = load(output / "last_checkpoint.pth")
    assert initial["epoch"] == 0 and initial["history"] == []
    assert initial["optimizer"]["state"] == {}
    assert initial["optimizer"]["param_groups"][0]["lr"] == 1e-5
    assert initial["scheduler"]["last_epoch"] == 0
    assert_same_weights(initial["model_state_dict"], load(source)["model_state_dict"])
    metrics = json.loads((output / "initial_val_metrics.json").read_text())
    assert metrics["epoch"] == 0 and metrics["img_size"] == 32
    assert metrics["init_checkpoint_sha256"] == hashlib.sha256(before).hexdigest()
    assert metrics["init_checkpoint_epoch"] == 3 and metrics["init_checkpoint_img_size"] == 256
    assert initial["best_model"]["epoch"] == 0
    assert source.read_bytes() == before
    # A disconnect before epoch one must allow a safe retry, even without --resume.
    monkeypatch.setattr(trainer, "train_epoch", real_train_epoch)
    run(output, "--max-epochs-this-run", "1")
    assert load(output / "last_checkpoint.pth")["epoch"] == 1
    assert source.read_bytes() == before


def test_resume_matches_uninterrupted_training_and_accepts_copied_source(experiment):
    root, source, run = experiment
    run(root / "whole")
    run(root / "split", "--max-epochs-this-run", "1")
    copy = root / "copied_best.pth"
    shutil.copyfile(source, copy)
    run(root / "split", "--resume", source_path=copy)
    whole, resumed = [load(root / folder / "last_checkpoint.pth") for folder in ("whole", "split")]
    assert whole["epoch"] == resumed["epoch"] == 3
    assert [row["epoch"] for row in resumed["history"]] == [1, 2, 3]
    assert whole["history"] == resumed["history"]
    assert whole["scheduler"] == resumed["scheduler"]
    assert_same_weights(whole["model_state_dict"], resumed["model_state_dict"])
    for key, moments in whole["optimizer"]["state"].items():
        assert_same_weights(moments, resumed["optimizer"]["state"][key])
    # The source need not remain mounted after an epoch checkpoint exists.
    run(root / "split", "--resume", source_path=None)
    assert load(root / "split" / "last_checkpoint.pth")["epoch"] == 3


def test_initial_epoch_is_eligible_for_best_when_finetuning_regresses(experiment, monkeypatch):
    root, source, run = experiment
    scores = iter([0.9, 0.2, 0.3, 0.9])

    def evaluate(*args):
        score = next(scores)
        return dict(accuracy=score, macro_f1=score, recall=[score] * 9,
                    support=[2] * 9, confusion_matrix=[[0] * 9 for _ in range(9)]), []

    monkeypatch.setattr(trainer, "evaluate", evaluate)
    run(root / "regressed")
    best = load(root / "regressed" / "best_model.pth")
    assert best["epoch"] == 0
    assert_same_weights(best["model_state_dict"], load(source)["model_state_dict"])
    assert json.loads((root / "regressed" / "val_metrics.json").read_text())["epoch"] == 0
    assert len(json.loads((root / "regressed" / "history.json").read_text())) == 3


@pytest.mark.parametrize("field,value", [
    ("arch", "resnet18"), ("classes", ["wrong"] * 9), ("manifest_sha256", "different"),
    ("train_images", 17), ("val_images", 17), ("smoke_per_class", 1),
    ("train_geometry", "full_resize"),
])
def test_source_mismatch_is_rejected_before_creating_output(experiment, field, value):
    root, source, run = experiment
    state = load(source)
    state["config"][field] = value
    torch.save(state, source)
    with pytest.raises((SystemExit, AssertionError), match="[Ii]nitial|[Ss]ource"):
        run(root / "invalid")
    assert not (root / "invalid").exists()


def test_source_run_cannot_be_overwritten(experiment):
    _, source, run = experiment
    before = {p.name: p.read_bytes() for p in source.parent.iterdir()}
    with pytest.raises(SystemExit, match="[Ss]ource|[Ii]nitial"):
        run(source.parent)
    assert {p.name: p.read_bytes() for p in source.parent.iterdir()} == before


def test_missing_last_checkpoint_does_not_allow_overwriting_trained_exports(experiment):
    root, _, run = experiment
    output = root / "lost_last"
    run(output, "--max-epochs-this-run", "1")
    (output / "last_checkpoint.pth").unlink()
    before = {p.name: p.read_bytes() for p in output.iterdir()}
    with pytest.raises(SystemExit, match="not empty"):
        run(output)
    assert {p.name: p.read_bytes() for p in output.iterdir()} == before


@pytest.mark.parametrize("extra", [("--lr", "2e-5"), ("--img-size", "48"),
                                 ("--train-geometry", "full_resize")])
def test_resume_rejects_changed_training_settings_without_writing(experiment, extra):
    root, _, run = experiment
    output = root / "resume"
    run(output, "--max-epochs-this-run", "1")
    before = {p.name: p.read_bytes() for p in output.iterdir()}
    with pytest.raises((SystemExit, AssertionError), match="mismatch"):
        run(output, "--resume", *extra, source_path=None)
    assert {p.name: p.read_bytes() for p in output.iterdir()} == before


def test_legacy_resume_defaults_keep_existing_runs_usable(experiment, monkeypatch):
    root, _, run = experiment
    # Build a legacy-compatible real checkpoint, then remove newly optional config keys.
    monkeypatch.setattr(trainer.models, "resnet50", lambda *, weights: TinyClassifier())
    output = root / "legacy"
    run(output, "--max-epochs-this-run", "1", source_path=None, lr=None)
    config = json.loads((output / "config.json").read_text())
    # Existing crop comparisons compare all config keys; optional provenance must
    # not make a new ImageNet run incompatible with an original crop run.
    assert not any(key.startswith("init_checkpoint_") for key in config)
    path = output / "last_checkpoint.pth"
    state = load(path)
    for key in ("train_geometry", "lr", "init_checkpoint_sha256", "init_checkpoint_epoch", "init_checkpoint_img_size"):
        state["config"].pop(key, None)
    torch.save(state, path)
    run(output, "--resume", source_path=None, lr=None)
    resumed = load(path)
    assert resumed["epoch"] == 3
    assert resumed["config"]["lr"] == 1e-4
    assert resumed["config"]["train_geometry"] == "random_crop"
