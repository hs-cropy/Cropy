"""ImageNet-only baseline for the audited worker split; no resume option."""
import argparse
import csv
import hashlib
import json
import random
from pathlib import Path

import numpy as np
import torch
import torchvision
from torch.utils.data import DataLoader
from torchvision import datasets, models

from train import get_transforms, train_epoch


def metrics(cm):
    cm = np.asarray(cm, dtype=np.int64)
    recall = np.divide(cm.diagonal(), cm.sum(1), out=np.zeros(len(cm)), where=cm.sum(1) > 0)
    precision = np.divide(cm.diagonal(), cm.sum(0), out=np.zeros(len(cm)), where=cm.sum(0) > 0)
    f1 = np.divide(2 * recall * precision, recall + precision,
                   out=np.zeros(len(cm)), where=(recall + precision) > 0)
    return dict(accuracy=float(cm.trace() / cm.sum()), macro_f1=float(f1.mean()),
                recall=recall.tolist(), support=cm.sum(1).tolist(), confusion_matrix=cm.tolist())


@torch.no_grad()
def evaluate(model, loader, device):
    model.eval()
    cm = np.zeros((len(loader.dataset.classes),) * 2, dtype=np.int64)
    predictions = []
    for images, labels in loader:
        scores, preds = model(images.to(device)).softmax(1).max(1)
        for actual, pred, score in zip(labels.tolist(), preds.cpu().tolist(), scores.cpu().tolist()):
            cm[actual, pred] += 1
            predictions.append(dict(actual=actual, predicted=pred, score=score))
    for row, (path, _) in zip(predictions, loader.dataset.samples):
        row['path'] = str(Path(path).relative_to(loader.dataset.root))
    return metrics(cm), predictions


def seed_worker(worker_id):
    seed = torch.initial_seed() % 2**32
    np.random.seed(seed)
    random.seed(seed)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--data-dir', type=Path, required=True)
    p.add_argument('--output-dir', type=Path, required=True)
    p.add_argument('--epochs', type=int, default=20)
    p.add_argument('--batch-size', type=int, default=32)
    p.add_argument('--num-workers', type=int, default=2)
    p.add_argument('--seed', type=int, default=42)
    p.add_argument('--img-size', type=int, choices=[224, 256], default=224)
    p.add_argument('--evaluate-test', action='store_true', help='Use only after model/configuration selection is frozen')
    a = p.parse_args()
    if a.evaluate_test:
        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        ckpt = torch.load(a.output_dir / 'best_model.pth', map_location='cpu', weights_only=True)
        model = models.resnet50(weights=None)
        model.fc = torch.nn.Linear(model.fc.in_features, len(ckpt['classes']))
        model.load_state_dict(ckpt['model_state_dict'])
        ds = datasets.ImageFolder(a.data_dir / 'test', transform=get_transforms(ckpt['img_size'])[1])
        assert ds.classes == ckpt['classes']
        result, rows = evaluate(model.to(device), DataLoader(ds, batch_size=a.batch_size), device)
        (a.output_dir / 'test_metrics.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
        (a.output_dir / 'test_predictions.json').write_text(json.dumps(rows, ensure_ascii=False), encoding='utf-8')
        print(result)
        return
    if not torch.cuda.is_available():
        raise SystemExit('Select a Colab GPU runtime before training.')
    if a.epochs < 1:
        raise SystemExit('epochs must be positive')
    a.output_dir.mkdir(parents=True, exist_ok=False)
    random.seed(a.seed)
    np.random.seed(a.seed)
    torch.manual_seed(a.seed)
    torch.cuda.manual_seed_all(a.seed)
    torch.backends.cudnn.benchmark = False
    torch.backends.cudnn.deterministic = True
    train_tf, val_tf = get_transforms(a.img_size)
    train_ds = datasets.ImageFolder(a.data_dir / 'train', transform=train_tf)
    val_ds = datasets.ImageFolder(a.data_dir / 'val', transform=val_tf)
    assert train_ds.classes == val_ds.classes and len(train_ds.classes) == 9
    generator = torch.Generator().manual_seed(a.seed)
    train_loader = DataLoader(train_ds, batch_size=a.batch_size, shuffle=True,
                              num_workers=a.num_workers, worker_init_fn=seed_worker, generator=generator)
    val_loader = DataLoader(val_ds, batch_size=a.batch_size, num_workers=a.num_workers,
                            worker_init_fn=seed_worker)
    config = dict(seed=a.seed, epochs=a.epochs, batch_size=a.batch_size, num_workers=a.num_workers,
                  arch='resnet50', img_size=a.img_size, initialization='ResNet50_Weights.IMAGENET1K_V2',
                  selection='highest val accuracy; earliest epoch on ties', balanced_sampler=False,
                  lr=1e-4, weight_decay=1e-4, label_smoothing=0.1,
                  torch=str(torch.__version__), torchvision=str(torchvision.__version__),
                  gpu=torch.cuda.get_device_name(0), classes=train_ds.classes,
                  split_manifest_sha256=hashlib.sha256((a.data_dir.parent / 'manifest.csv').read_bytes()).hexdigest())
    (a.output_dir / 'config.json').write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding='utf-8')
    model = models.resnet50(weights=models.ResNet50_Weights.IMAGENET1K_V2)
    model.fc = torch.nn.Linear(model.fc.in_features, 9)
    model.to('cuda')
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-4, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=a.epochs)
    criterion = torch.nn.CrossEntropyLoss(label_smoothing=0.1)
    best = -1.0
    for epoch in range(1, a.epochs + 1):
        loss, accuracy = train_epoch(model, train_loader, criterion, optimizer, 'cuda')
        result, rows = evaluate(model, val_loader, 'cuda')
        record = dict(epoch=epoch, train_loss=loss, train_accuracy=accuracy / 100,
                      lr=optimizer.param_groups[0]['lr'], val=result)
        with (a.output_dir / 'history.jsonl').open('a', encoding='utf-8') as f:
            f.write(json.dumps(record) + '\n')
        print(f"Epoch {epoch}/{a.epochs}: train={accuracy:.2f}% val={result['accuracy']:.2%} "
              f"macro_f1={result['macro_f1']:.4f} recall={result['recall']}", flush=True)
        if result['accuracy'] > best:
            best = result['accuracy']
            torch.save(dict(model_state_dict=model.state_dict(), classes=train_ds.classes,
                            num_classes=9, arch='resnet50', img_size=a.img_size, epoch=epoch,
                            val_accuracy=best, config=config), a.output_dir / 'best_model.pth')
            (a.output_dir / 'val_metrics.json').write_text(json.dumps(dict(epoch=epoch, **result), indent=2), encoding='utf-8')
            with (a.output_dir / 'val_predictions.csv').open('w', encoding='utf-8-sig', newline='') as f:
                writer = csv.DictWriter(f, fieldnames=['actual', 'predicted', 'score', 'path'])
                writer.writeheader()
                writer.writerows(rows)
        scheduler.step()
    print(f'Complete. Best val: {best:.2%}. Test not evaluated.', flush=True)


if __name__ == '__main__':
    main()
