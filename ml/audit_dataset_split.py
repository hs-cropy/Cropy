"""Read-only split audit. dHash matches are review candidates, not duplicate proof."""
import csv
import hashlib
import io
import json
from collections import Counter, defaultdict
from pathlib import Path
import zipfile

from PIL import Image


def main():
    root = Path(__file__).resolve().parents[1]
    output = root / 'output/colab/split_audit_20260918'
    output.mkdir(exist_ok=False)
    rows = []
    with zipfile.ZipFile(root/'output/colab/cropy_week3_bundle.zip') as z:
        for name in sorted(z.namelist()):
            parts = name.split('/')
            if len(parts) != 4 or not name.lower().endswith(('.jpg', '.jpeg', '.png')):
                continue
            data = z.read(name)
            with Image.open(io.BytesIO(data)) as im:
                rgb = im.convert('RGB')
                pixel_hash = hashlib.sha256(str(rgb.size).encode()+rgb.tobytes()).hexdigest()
                pixels = list(rgb.convert('L').resize((9, 8)).getdata())
                dh = sum((pixels[y*9+x] > pixels[y*9+x+1]) << (y*8+x)
                         for y in range(8) for x in range(8))
            tokens = Path(name).stem.split('_')
            # Conservative filename heuristic only; metadata needed to establish identity.
            group = '_'.join(tokens[:10]) if len(tokens) >= 10 else Path(name).stem
            rows.append({'path':name, 'split':parts[1], 'class':parts[2],
                         'sha256':hashlib.sha256(data).hexdigest(),
                         'pixel_sha256':pixel_hash, 'dhash':dh, 'filename_group':group})
    def crossing(field):
        groups = defaultdict(list)
        for row in rows: groups[row[field]].append(row)
        return [v for v in groups.values() if len({r['split'] for r in v}) > 1]
    pairs = []
    for i, a in enumerate(rows):
        for b in rows[i+1:]:
            if a['split'] == b['split']: continue
            distance = (a['dhash'] ^ b['dhash']).bit_count()
            if distance <= 4:
                pairs.append({'a':a['path'], 'b':b['path'], 'distance':distance,
                              'same_class':a['class']==b['class']})
    with (output/'similarity_candidates.csv').open('w',encoding='utf-8-sig',newline='') as f:
        w=csv.DictWriter(f,fieldnames=['a','b','distance','same_class']);w.writeheader();w.writerows(pairs)
    summary = {'scope':'Colab bundle images; no model evaluation or dataset modification',
               'counts':dict(Counter(r['split'] for r in rows)),
               'cross_split_byte_duplicate_groups':crossing('sha256'),
               'cross_split_pixel_duplicate_groups':crossing('pixel_sha256'),
               'filename_group_definition':'First 10 underscore-separated stem tokens, heuristic only',
               'cross_split_filename_groups':crossing('filename_group'),
               'dhash_max_distance':4,'similarity_candidate_pairs':len(pairs)}
    (output/'audit.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:(len(v) if k.startswith('cross_split') else v) for k,v in summary.items()},ensure_ascii=False))


if __name__ == '__main__':
    main()
