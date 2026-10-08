import csv
import hashlib
import io
import json
import zipfile
from pathlib import Path

import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
NEW = next((ROOT / 'output').glob('cropy_group256_results*.zip'))
OLD = next((ROOT / 'output/colab').glob('cropy_group_results*.zip'))

def read_run(path):
    with zipfile.ZipFile(path) as z:
        assert z.testzip() is None
        config = json.loads(z.read('config.json'))
        recorded = json.loads(z.read('val_metrics.json'))
        history = [json.loads(s) for s in z.read('history.jsonl').splitlines()]
        manifest_bytes = z.read('manifest.csv')
        assert hashlib.sha256(manifest_bytes).hexdigest() == config['split_manifest_sha256']
        manifest = list(csv.DictReader(io.StringIO(manifest_bytes.decode('utf-8-sig'))))
        predictions = list(csv.DictReader(io.StringIO(z.read('val_predictions.csv').decode('utf-8-sig'))))
        expected = {r['bundle_path'].removeprefix('dataset/val/'): int(r['class'].split('_')[0])
                    for r in manifest if r['bundle_path'].startswith('dataset/val/')}
        assert len(predictions) == len(expected) == len({r['path'] for r in predictions})
        cm = np.zeros((9, 9), dtype=int)
        for r in predictions:
            a, p, score = int(r['actual']), int(r['predicted']), float(r['score'])
            assert expected[r['path']] == a and 0 <= p < 9 and 0 <= score <= 1
            cm[a, p] += 1
        assert np.array_equal(cm, recorded['confusion_matrix'])
        f1 = np.divide(2 * cm.diagonal(), cm.sum(0) + cm.sum(1))
        assert abs(float(f1.mean()) - recorded['macro_f1']) < 1e-12
        assert abs(float(cm.trace() / cm.sum()) - recorded['accuracy']) < 1e-12
        best = max(history, key=lambda h: h['val']['accuracy'])
        assert [h['epoch'] for h in history] == list(range(1, 21))
        assert best['epoch'] == recorded['epoch']
        model_bytes = z.read('best_model.pth')
        checkpoint = torch.load(io.BytesIO(model_bytes), map_location='cpu', weights_only=True)
        for key in ['arch', 'img_size', 'classes']:
            assert checkpoint[key] == config[key]
        assert checkpoint['num_classes'] == 9 and checkpoint['epoch'] == best['epoch']
        assert all(torch.isfinite(t).all() for t in checkpoint['model_state_dict'].values())
        if path == NEW:
            for name in ['config.json', 'val_metrics.json', 'history.jsonl', 'val_confusion.png']:
                (OUT / name).write_bytes(z.read(name))
        return config, recorded, predictions, cm, hashlib.sha256(model_bytes).hexdigest()

old, new = read_run(OLD), read_run(NEW)
assert old[0]['split_manifest_sha256'] == new[0]['split_manifest_sha256']
for key in ['seed', 'epochs', 'batch_size', 'arch', 'initialization', 'selection', 'balanced_sampler', 'lr', 'weight_decay', 'label_smoothing', 'classes']:
    assert old[0][key] == new[0][key], key
before = {r['path']: r for r in old[2]}
fixed = regressed = 0
paired = []
for r in new[2]:
    prev = before[r['path']]
    assert prev['actual'] == r['actual']
    was_right, is_right = prev['actual'] == prev['predicted'], r['actual'] == r['predicted']
    fixed += int(not was_right and is_right)
    regressed += int(was_right and not is_right)
    paired.append(dict(path=r['path'], actual=r['actual'], previous=prev['predicted'], predicted=r['predicted'], score=r['score'], change='fixed' if not was_right and is_right else 'regressed' if was_right and not is_right else 'unchanged'))
for name, rows in [('paired_predictions.csv', paired), ('val_errors.csv', [r for r in paired if r['actual'] != r['predicted']])]:
    with (OUT / name).open('w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=paired[0].keys())
        writer.writeheader()
        writer.writerows(rows)
summary = dict(zip=NEW.name, zip_crc=True, manifest_sha256=new[0]['split_manifest_sha256'], same_split=True,
               predictions_checked=len(new[2]), best_epoch=new[1]['epoch'], checkpoint_sha256=new[4],
               checkpoint_metadata_valid=True, finite_weights=True, accuracy=new[1]['accuracy'], macro_f1=new[1]['macro_f1'],
               previous_accuracy=old[1]['accuracy'], previous_macro_f1=old[1]['macro_f1'],
               fixed=fixed, regressed=regressed, disease_to_normal=int(new[3][:6, 6:].sum()),
               previous_disease_to_normal=int(old[3][:6, 6:].sum()), test_evaluated=False, full_local_inference=False)
(OUT / 'verification.json').write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding='utf-8')
print(json.dumps(summary, indent=2, ensure_ascii=True))
