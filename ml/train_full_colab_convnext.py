"""Full official-split training with epoch-boundary resume and Macro F1 selection."""
import argparse
import hashlib
import json
import random
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import DataLoader, WeightedRandomSampler
from torchvision import datasets, models

from train import get_transforms, train_epoch
from train_group_baseline import evaluate, seed_worker


def save_atomic(value, path):
    temporary = path.with_suffix(path.suffix + '.tmp')
    torch.save(value, temporary)
    temporary.replace(path)


def _config_with_train_geometry(config):
    """Compare legacy crop runs without changing their stored configuration."""
    config = config.copy()
    config.setdefault('train_geometry', 'random_crop')
    return config


def _normalize_config(config):
    config = _config_with_train_geometry(config)
    config.setdefault('lr', 1e-4)
    config.setdefault('blur_aug', False)
    for key in ('init_checkpoint_sha256', 'init_checkpoint_epoch', 'init_checkpoint_img_size', 'warm_start_sha256'):
        config.setdefault(key, None)
    return config


def load_initial_checkpoint(path, config):
    """Validate the source experiment, allowing only its input resolution to differ."""
    with path.open('rb') as file:
        digest = hashlib.file_digest(file, 'sha256').hexdigest()
    source = torch.load(path, map_location='cpu', weights_only=True)
    source_config = _config_with_train_geometry(source.get('config', {}))
    for key in ('arch', 'classes', 'manifest_sha256', 'train_images', 'val_images',
                'smoke_per_class', 'train_geometry'):
        if source_config.get(key) != config[key]:
            raise SystemExit(f'Initial checkpoint source {key} mismatch.')
    for key in ('arch', 'classes'):
        if source.get(key) != config[key]:
            raise SystemExit(f'Initial checkpoint source {key} mismatch.')
    if source.get('num_classes') != len(config['classes']):
        raise SystemExit('Initial checkpoint source num_classes mismatch.')
    if (not isinstance(source.get('epoch'), int) or source['epoch'] < 0
            or not isinstance(source.get('img_size'), int) or source['img_size'] <= 0
            or source['img_size'] != source_config.get('img_size')):
        raise SystemExit('Initial checkpoint source epoch/img_size metadata is invalid.')
    provenance = dict(init_checkpoint_sha256=digest, init_checkpoint_epoch=source['epoch'],
                      init_checkpoint_img_size=source['img_size'])
    return source, provenance


def warm_start(model, path, classes):
    """Start a run with new classes from another run: backbone as-is, shared fc rows by class name.

    Rows for new classes keep their fresh initialization. Unlike --init-checkpoint, the
    source may have different classes and data; only its weights are reused.
    """
    with path.open('rb') as file:
        digest = hashlib.file_digest(file, 'sha256').hexdigest()
    source = torch.load(path, map_location='cpu', weights_only=True)
    weights = source['model_state_dict']
    shared = [(classes.index(name), row) for row, name in enumerate(source['classes']) if name in classes]
    if not shared:
        raise SystemExit('Warm-start checkpoint shares no class names with this dataset.')
    fc_weight, fc_bias = model.fc.weight.detach().clone(), model.fc.bias.detach().clone()
    for target, row in shared:
        fc_weight[target] = weights['fc.weight'][row]
        fc_bias[target] = weights['fc.bias'][row]
    weights = {k: v for k, v in weights.items() if not k.startswith('fc.')}
    weights.update({'fc.weight': fc_weight, 'fc.bias': fc_bias})
    model.load_state_dict(weights, strict=True)
    return digest


def build_model(arch, num_classes, pretrained=True):
    """ImageNet backbone with a fresh classification head; checkpoints store `arch` so inference can rebuild it."""
    if arch == 'convnext_tiny':
        model = models.convnext_tiny(weights=models.ConvNeXt_Tiny_Weights.DEFAULT if pretrained else None)
        model.classifier[2] = torch.nn.Linear(model.classifier[2].in_features, num_classes)
        return model
    builder = models.resnet50 if arch == 'resnet50' else models.resnet18
    weights = models.ResNet50_Weights.DEFAULT if arch == 'resnet50' else models.ResNet18_Weights.DEFAULT
    model = builder(weights=weights if pretrained else None)
    model.fc = torch.nn.Linear(model.fc.in_features, num_classes)
    return model


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--data-dir', type=Path, required=True, help='dataset/images')
    p.add_argument('--output-dir', type=Path, required=True)
    p.add_argument('--epochs', type=int, default=20)
    p.add_argument('--batch-size', type=int, default=16)
    p.add_argument('--num-workers', type=int, default=2)
    p.add_argument('--img-size', type=int, default=256)
    p.add_argument('--train-geometry', choices=['random_crop', 'full_resize'], default='random_crop')
    p.add_argument('--arch', choices=['resnet18', 'resnet50', 'convnext_tiny'], default='resnet50')
    p.add_argument('--init-checkpoint', type=Path, help='Start a new fine-tune from all checkpoint weights')
    p.add_argument('--warm-start', type=Path, help='Start a new run from a checkpoint with other classes/data '
                   '(backbone + fc rows of shared class names)')
    p.add_argument('--blur-aug', action='store_true', help='Random Gaussian blur for every training class')
    p.add_argument('--expect-images', type=int, nargs=2, metavar=('TRAIN', 'VAL'),
                   help='Required full-run image counts (default: the 9-class official split)')
    p.add_argument('--lr', type=float, default=1e-4)
    p.add_argument('--resume', action='store_true')
    p.add_argument('--allow-cpu', action='store_true', help='Local pipeline checks only')
    p.add_argument('--smoke-per-class', type=int, default=0, help='0 uses all images; nonzero is NOT a full run')
    p.add_argument('--max-epochs-this-run', type=int, default=0, help='Stop cleanly after N additional epochs')
    a = p.parse_args()
    last_path = a.output_dir / 'last_checkpoint.pth'
    if a.resume and not last_path.is_file():
        raise SystemExit(f'--resume requires an existing checkpoint: {last_path}. '
                         'Restore the checkpoint or start a new run without --resume in a new output directory.')
    assert a.epochs > 0 and a.batch_size > 1 and a.smoke_per_class >= 0
    assert np.isfinite(a.lr) and a.lr > 0
    if a.init_checkpoint and a.warm_start:
        raise SystemExit('Use either --init-checkpoint or --warm-start.')
    if a.init_checkpoint and a.output_dir.resolve() == a.init_checkpoint.resolve().parent:
        raise SystemExit('Initial checkpoint source run cannot be used as the output directory.')
    if not torch.cuda.is_available() and not a.allow_cpu:
        raise SystemExit('GPU runtime required. Select a Colab GPU before running.')
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    if device == 'cpu':
        torch.set_num_threads(2)
    random.seed(42)
    np.random.seed(42)
    torch.manual_seed(42)
    torch.backends.cudnn.benchmark = False
    torch.backends.cudnn.deterministic = True
    datasets_pair = []
    for split, transform in zip(('train', 'val'), get_transforms(a.img_size, train_geometry=a.train_geometry,
                                                                 blur=a.blur_aug)):
        ds = datasets.ImageFolder(a.data_dir / split, transform=transform)
        if a.smoke_per_class:
            ds.samples = [sample for c in range(len(ds.classes))
                          for sample in [s for s in ds.samples if s[1] == c][:a.smoke_per_class]]
            ds.imgs = ds.samples
            ds.targets = [t for _, t in ds.samples]
        datasets_pair.append(ds)
    train_ds, val_ds = datasets_pair
    num_classes = len(train_ds.classes)
    assert train_ds.classes == val_ds.classes and num_classes >= 2
    if not a.smoke_per_class:
        expected = tuple(a.expect_images) if a.expect_images else (32513, 4070) if num_classes == 9 else None
        if expected is None:
            raise SystemExit('--expect-images TRAIN VAL is required for a full run with new classes.')
        assert (len(train_ds), len(val_ds)) == expected
    fingerprint = hashlib.sha256((a.data_dir.parent / 'manifest.csv').read_bytes()).hexdigest()
    config = dict(arch=a.arch, epochs=a.epochs, batch_size=a.batch_size, img_size=a.img_size,
                  train_geometry=a.train_geometry, blur_aug=a.blur_aug,
                  seed=42, lr=a.lr, balanced_sampler=True, selection='highest validation macro_f1; earliest tie',
                  manifest_sha256=fingerprint, classes=train_ds.classes, smoke_per_class=a.smoke_per_class,
                  train_images=len(train_ds), val_images=len(val_ds), num_workers=a.num_workers)
    state = torch.load(last_path, map_location='cpu', weights_only=True) if a.resume else None
    if not a.resume and last_path.exists():
        candidate = torch.load(last_path, map_location='cpu', weights_only=True)
        # An initialized fine-tune has no completed training epoch to overwrite.
        if candidate['epoch'] == 0 and candidate['config'].get('init_checkpoint_sha256'):
            state = candidate
    source = None
    if a.init_checkpoint:
        source, provenance = load_initial_checkpoint(a.init_checkpoint, config)
        config.update(provenance)
    elif state:
        original_config = _normalize_config(state['config'])
        if original_config['init_checkpoint_sha256']:
            for key in ('init_checkpoint_sha256', 'init_checkpoint_epoch', 'init_checkpoint_img_size'):
                config[key] = original_config[key]
        config['warm_start_sha256'] = original_config['warm_start_sha256']
    if a.warm_start and not state:
        with a.warm_start.open('rb') as file:
            config['warm_start_sha256'] = hashlib.file_digest(file, 'sha256').hexdigest()
    if state:
        assert _normalize_config(state['config']) == _normalize_config(config), 'Resume configuration/data mismatch; keep the original settings.'
    if not a.resume and a.output_dir.exists() and any(a.output_dir.iterdir()):
        # Also accept our own epoch-zero exports if interrupted before training began.
        names = {f.name for f in a.output_dir.iterdir()}
        config_path = a.output_dir / 'config.json'
        allowed = {'config.json', 'environment.json', 'last_checkpoint.pth.tmp'}
        if config.get('init_checkpoint_sha256'):
            allowed |= {'initial_val_metrics.json', 'best_model.pth', 'best_model.pth.tmp',
                        'history.json', 'val_metrics.json'}
            if state and state['epoch'] == 0:
                allowed.add('last_checkpoint.pth')
        restartable = names <= allowed and config_path.exists()
        if restartable and not state:
            # Missing last_checkpoint alone must never turn trained exports into a fresh run.
            try:
                for name in ('history.json', 'val_metrics.json'):
                    if name in names:
                        exported = json.loads((a.output_dir / name).read_text(encoding='utf-8'))
                        restartable &= exported == [] if name == 'history.json' else exported.get('epoch') == 0
                if 'best_model.pth' in names:
                    restartable &= torch.load(a.output_dir / 'best_model.pth', map_location='cpu', weights_only=True)['epoch'] == 0
            except (ValueError, KeyError, AttributeError):
                restartable = False
        if not restartable or _normalize_config(json.loads(config_path.read_text(encoding='utf-8'))) != _normalize_config(config):
            raise SystemExit('Output directory is not empty. Use --resume or a new run directory.')
    model = build_model(a.arch, num_classes, pretrained=not (state or source or a.warm_start))
    if source and not state:
        model.load_state_dict(source['model_state_dict'])
    del source
    if a.warm_start and not state:
        assert a.arch != 'convnext_tiny', '--warm-start supports resnet only'
        torch.manual_seed(42)  # reproducible rows for the new classes
        model.fc.reset_parameters()
        assert warm_start(model, a.warm_start, train_ds.classes) == config['warm_start_sha256']
    model.to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=a.epochs)
    generator = torch.Generator().manual_seed(42)
    counts = np.bincount(train_ds.targets, minlength=num_classes)
    assert np.all(counts > 0)
    sampler = WeightedRandomSampler([1.0 / counts[t] for t in train_ds.targets], len(train_ds), replacement=True, generator=generator)
    train_loader = DataLoader(train_ds, batch_size=a.batch_size, sampler=sampler, num_workers=a.num_workers,
                              worker_init_fn=seed_worker, generator=generator, pin_memory=device == 'cuda')
    val_loader = DataLoader(val_ds, batch_size=a.batch_size, shuffle=False, num_workers=a.num_workers,
                            worker_init_fn=seed_worker, pin_memory=device == 'cuda')
    history, best, best_state, first = [], -1.0, None, 1
    initial_metrics = None
    if state:
        model.load_state_dict(state['model_state_dict'])
        optimizer.load_state_dict(state['optimizer'])
        scheduler.load_state_dict(state['scheduler'])
        history, best, best_state, first = state['history'], state['best'], state['best_model'], state['epoch'] + 1
        initial_metrics = state.get('initial_val_metrics')
        random.setstate(state['python_rng'])
        torch.set_rng_state(state['torch_rng'])
        generator.set_state(state['loader_rng'])
        if device == 'cuda':
            torch.cuda.set_rng_state_all(state['cuda_rng'])
    a.output_dir.mkdir(parents=True, exist_ok=True)
    (a.output_dir / 'config.json').write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding='utf-8')
    (a.output_dir / 'environment.json').write_text(json.dumps(dict(torch=str(torch.__version__), device=device,
        gpu=torch.cuda.get_device_name(0) if device == 'cuda' else None)), encoding='utf-8')
    criterion = torch.nn.CrossEntropyLoss(label_smoothing=0.1)

    def best_checkpoint(epoch, result):
        return dict(model_state_dict={k: v.detach().cpu().clone() for k, v in model.state_dict().items()},
                    arch=a.arch, classes=train_ds.classes, num_classes=num_classes, img_size=a.img_size,
                    epoch=epoch, val_metrics=result, config=config)

    def training_checkpoint(epoch):
        return dict(epoch=epoch, model_state_dict=model.state_dict(), optimizer=optimizer.state_dict(),
                    scheduler=scheduler.state_dict(), config=config, history=history, best=best, best_model=best_state,
                    initial_val_metrics=initial_metrics,
                    python_rng=random.getstate(), torch_rng=torch.get_rng_state(), loader_rng=generator.get_state(),
                    cuda_rng=torch.cuda.get_rng_state_all() if device == 'cuda' else [])

    if config.get('init_checkpoint_sha256') and not state:
        result, _ = evaluate(model, val_loader, device)
        best, best_state = result['macro_f1'], best_checkpoint(0, result)
        initial_metrics = dict(epoch=0, img_size=a.img_size, **result,
                               **{k: config[k] for k in ('init_checkpoint_sha256', 'init_checkpoint_epoch',
                                                        'init_checkpoint_img_size')})
        state = training_checkpoint(0)
        save_atomic(state, last_path)
    if initial_metrics is not None:
        (a.output_dir / 'initial_val_metrics.json').write_text(json.dumps(initial_metrics, indent=2), encoding='utf-8')
        # These exports are useful even if the first training epoch is interrupted.
        save_atomic(best_state, a.output_dir / 'best_model.pth')
        (a.output_dir / 'history.json').write_text(json.dumps(history, indent=2), encoding='utf-8')
        (a.output_dir / 'val_metrics.json').write_text(
            json.dumps(dict(epoch=best_state['epoch'], **best_state['val_metrics']), indent=2), encoding='utf-8')
    final = min(a.epochs, first + a.max_epochs_this_run - 1) if a.max_epochs_this_run else a.epochs
    print(f'{device}: train={len(train_ds)}, val={len(val_ds)}, epochs={first}..{final}', flush=True)
    for epoch in range(first, final + 1):
        loss, accuracy = train_epoch(model, train_loader, criterion, optimizer, device)
        assert np.isfinite(loss), 'Non-finite loss'
        result, _ = evaluate(model, val_loader, device)
        history.append(dict(epoch=epoch, train_loss=loss, train_accuracy=accuracy / 100, val=result))
        if result['macro_f1'] > best:
            best = result['macro_f1']
            best_state = best_checkpoint(epoch, result)
        scheduler.step()
        state = training_checkpoint(epoch)
        save_atomic(state, last_path)
        print(f"Epoch {epoch}/{a.epochs}: loss={loss:.4f}, val={result['accuracy']:.2%}, macro_f1={result['macro_f1']:.4f}", flush=True)
        # Exports are reconstructible from the last complete checkpoint after interruption.
        save_atomic(best_state, a.output_dir / 'best_model.pth')
        (a.output_dir / 'history.json').write_text(json.dumps(history, indent=2), encoding='utf-8')
    assert best_state is not None
    save_atomic(best_state, a.output_dir / 'best_model.pth')
    (a.output_dir / 'history.json').write_text(json.dumps(history, indent=2), encoding='utf-8')
    (a.output_dir / 'val_metrics.json').write_text(
        json.dumps(dict(epoch=best_state['epoch'], **best_state['val_metrics']), indent=2), encoding='utf-8')
    print(f'Saved through epoch {state["epoch"]}; best Macro F1={best:.4f}. No test evaluation.', flush=True)


if __name__ == '__main__':
    main()
