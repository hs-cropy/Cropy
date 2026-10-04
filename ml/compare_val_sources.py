"""동일 val 파일의 로컬 원본과 Colab 축소본을 같은 모델로 비교한다."""
import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
import zipfile

import torch
import torchvision
from PIL import Image
from torchvision import models, transforms


def sha(path):
    with open(path, 'rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--original-val', default='data/dataset/val')
    p.add_argument('--bundle', default='output/colab/cropy_week3_bundle.zip')
    p.add_argument('--checkpoint', default='ml/checkpoints/best_model.pth')
    p.add_argument('--output', required=True)
    p.add_argument('--batch-size', type=int, default=16)
    args = p.parse_args()
    torch.set_num_threads(4)
    dest = Path(args.output)
    dest.mkdir(parents=True, exist_ok=False)
    checkpoint = torch.load(args.checkpoint, map_location='cpu', weights_only=True)
    classes = checkpoint['classes']
    size = int(checkpoint.get('img_size', 224))
    model = getattr(models, checkpoint.get('arch', 'resnet18'))(weights=None)
    model.fc = torch.nn.Linear(model.fc.in_features, len(classes))
    model.load_state_dict(checkpoint['model_state_dict'])
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    model.to(device).eval()
    tf = transforms.Compose([transforms.Resize((size, size)), transforms.ToTensor(),
                             transforms.Normalize([.485, .456, .406], [.229, .224, .225])])
    originals = {}
    root = Path(args.original_val)
    for f in root.rglob('*'):
        if f.is_file() and f.suffix.lower() in {'.jpg', '.jpeg', '.png'}:
            key = str(f.relative_to(root).with_suffix('')).replace('\\', '/')
            if key in originals:
                raise ValueError(f'중복 원본 키: {key}')
            originals[key] = f
    with zipfile.ZipFile(args.bundle) as z:
        reduced = {}
        for name in z.namelist():
            if name.startswith('dataset/val/') and not name.endswith('/'):
                key = str(Path(name[len('dataset/val/'):]).with_suffix('')).replace('\\', '/')
                if key in reduced:
                    raise ValueError(f'중복 축소본 키: {key}')
                reduced[key] = name
        assert originals and originals.keys() == reduced.keys(), '원본/축소본 val 파일 불일치'
        assert sorted({k.split('/')[0] for k in originals}) == classes
        manifest = json.loads(z.read('manifest.json'))
        assert sha(args.checkpoint) == manifest['checkpoint_sha256']
        source_hashes = {v['path']: v['sha256'] for v in manifest['dataset_files']}
        keys = sorted(originals)
        rows = []
        for start in range(0, len(keys), args.batch_size):
            batch = keys[start:start+args.batch_size]
            a, b, records = [], [], []
            for key in batch:
                raw = originals[key].read_bytes()
                small = z.read(reduced[key])
                assert hashlib.sha256(small).hexdigest() == source_hashes[reduced[key]]
                with Image.open(io.BytesIO(raw)) as im:
                    original_size = im.size
                    a.append(tf(im.convert('RGB')))
                with Image.open(io.BytesIO(small)) as im:
                    reduced_size = im.size
                    b.append(tf(im.convert('RGB')))
                records.append({'key': key, 'actual': classes.index(key.split('/')[0]),
                                'original_sha256': hashlib.sha256(raw).hexdigest(),
                                'original_size': str(original_size), 'reduced_size': str(reduced_size)})
            with torch.inference_mode():
                pa = model(torch.stack(a).to(device)).softmax(1).cpu()
                pb = model(torch.stack(b).to(device)).softmax(1).cpu()
            for r, va, vb in zip(records, pa, pb):
                r.update(original_pred=int(va.argmax()), reduced_pred=int(vb.argmax()),
                         original_score=float(va.max()), reduced_score=float(vb.max()))
                rows.append(r)
            print(f'{len(rows)}/{len(keys)}', flush=True)
    summary = {'n': len(rows), 'classes': classes, 'device': str(device),
               'torch': torch.__version__, 'torchvision': torchvision.__version__,
               'img_size': size, 'checkpoint_sha256': sha(args.checkpoint),
               'bundle_sha256': sha(args.bundle), 'tta': False}
    for source in ['original', 'reduced']:
        cm = [[0]*len(classes) for _ in classes]
        for r in rows:
            cm[r['actual']][r[source+'_pred']] += 1
        summary[source] = {'accuracy': sum(cm[i][i] for i in range(len(classes)))/len(rows),
                           'confusion': cm,
                           'per_class_accuracy': [cm[i][i]/sum(cm[i]) for i in range(len(classes))]}
    summary['original_only_correct'] = sum(r['original_pred']==r['actual'] and r['reduced_pred']!=r['actual'] for r in rows)
    summary['reduced_only_correct'] = sum(r['reduced_pred']==r['actual'] and r['original_pred']!=r['actual'] for r in rows)
    summary['changed_predictions'] = sum(r['original_pred']!=r['reduced_pred'] for r in rows)
    (dest/'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    with (dest/'paired_predictions.csv').open('w', newline='', encoding='utf-8-sig') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
    print(json.dumps({k:v for k,v in summary.items() if k not in ['original','reduced','classes']}, ensure_ascii=False))
    print('original:', summary['original']['accuracy'], 'reduced:', summary['reduced']['accuracy'])


if __name__ == '__main__':
    main()
