"""AI Hub 원본(5472x3648) 무 질병 사진에서 병반 박스를 원본 해상도로 잘라 긴 변 1024px로 저장한다.

입력: data/full/원천데이터/{trian,val}무질병원천데이터.tar (안에 zip 조각), prepared_deduplicated_v1/labels (박스), worker_split_v1.csv (분할)
출력: radish_hires_crops/{train,val,test}/{2_무검은무늬병,3_무노균병}/<원본 파일명>.jpg + crop_index.csv, 그리고 zip
"""
import csv, io, json, shutil, sys, tarfile, zipfile
from pathlib import Path
from collections import Counter
from PIL import Image

HERE = Path(__file__).resolve().parent
FULL = Path(r'C:\cropy\data\full')
LABELS = FULL / 'prepared_deduplicated_v1' / 'labels'
OUT = HERE / 'radish_hires_crops'
TMP = HERE / 'tmp_zip'
MARGIN, LONG = 0.15, 1024
CLASSES = {'2': '2_무검은무늬병', '3': '3_무노균병'}
TARS = {'train': FULL / '원천데이터' / 'trian무질병원천데이터.tar', 'val': FULL / '원천데이터' / 'val무질병원천데이터.tar'}

split_of = {}
for r in csv.DictReader((HERE / 'worker_split_v1.csv').open(encoding='utf-8')):
    if r['class_id'] in CLASSES:
        split_of[Path(r['path']).stem.lower()] = (r['split'], CLASSES[r['class_id']], r['worker'])
print('무 질병 사진(분할표):', len(split_of))

boxes = {}
for j in LABELS.rglob('*.json'):
    if j.parent.name not in CLASSES.values():
        continue
    d = json.loads(j.read_text(encoding='utf-8'))
    pts = [p for p in ((d.get('annotations') or {}).get('points') or []) if all(k in p for k in ('xtl', 'ytl', 'xbr', 'ybr'))]
    W, H = d['description'].get('width'), d['description'].get('height')
    stem = Path(j.name[:-5]).stem.lower()
    if not pts or not W or not H:
        boxes[stem] = None
        continue
    boxes[stem] = (min(p['xtl'] for p in pts) / W, min(p['ytl'] for p in pts) / H, max(p['xbr'] for p in pts) / W, max(p['ybr'] for p in pts) / H)
print('라벨 박스:', sum(v is not None for v in boxes.values()), '/', len(boxes))


def assemble_zip(tar_path, dest):
    """tar 안의 .zip.partNNN 조각을 오프셋 순으로 이어 붙여 완전한 zip을 만든다."""
    if dest.exists():
        return dest
    with tarfile.open(tar_path) as tf, dest.open('wb') as out:
        parts = sorted((m for m in tf.getmembers() if '.zip.part' in m.name), key=lambda m: int(m.name.rsplit('.part', 1)[1]))
        for m in parts:
            shutil.copyfileobj(tf.extractfile(m), out, 16 * 1024 * 1024)
    return dest


if OUT.exists():
    shutil.rmtree(OUT)
TMP.mkdir(exist_ok=True)
stats = Counter()
sizes = []
index = []
for official, tar_path in TARS.items():
    zpath = assemble_zip(tar_path, TMP / f'{official}_radish_disease.zip')
    with zipfile.ZipFile(zpath) as z:
        members = {Path(n).stem.lower(): n for n in z.namelist() if not n.endswith('/')}
        print(official, 'zip 사진 수:', len(members))
        for stem, name in members.items():
            info = split_of.get(stem)
            if info is None:
                stats['not_in_split'] += 1
                continue
            split, cls, worker = info
            rel = boxes.get(stem)
            if rel is None:
                stats['no_box'] += 1
                continue
            with z.open(name) as f:
                im = Image.open(io.BytesIO(f.read())).convert('RGB')
            w, h = im.size
            bw, bh = (rel[2] - rel[0]) * w, (rel[3] - rel[1]) * h
            l = max(0, int(rel[0] * w - MARGIN * bw)); t = max(0, int(rel[1] * h - MARGIN * bh))
            r_ = min(w, int(rel[2] * w + MARGIN * bw)); b = min(h, int(rel[3] * h + MARGIN * bh))
            crop = im.crop((l, t, r_, b))
            cw, ch = crop.size
            sizes.append(max(cw, ch))
            scale = min(1.0, LONG / max(cw, ch))
            if scale < 1.0:
                crop = crop.resize((round(cw * scale), round(ch * scale)), Image.LANCZOS)
            dst = OUT / split / cls / (Path(name).stem + '.jpg')
            dst.parent.mkdir(parents=True, exist_ok=True)
            crop.save(dst, quality=90)
            stats[f'{split}/{cls}'] += 1
            index.append([split, cls, worker, Path(name).name, w, h, cw, ch, crop.size[0], crop.size[1]])
            if len(index) % 100 == 0:
                print('진행', len(index), flush=True)

with (OUT / 'crop_index.csv').open('w', newline='', encoding='utf-8') as f:
    wr = csv.writer(f)
    wr.writerow(['split', 'class', 'worker', 'file', 'orig_w', 'orig_h', 'crop_w', 'crop_h', 'saved_w', 'saved_h'])
    wr.writerows(index)
sizes.sort()
summary = dict(stats=dict(stats), crop_long_side_px=dict(n=len(sizes), p10=sizes[len(sizes) // 10], p50=sizes[len(sizes) // 2], p90=sizes[9 * len(sizes) // 10]), saved_long_side_max=LONG, margin=MARGIN)
(OUT / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding='utf-8')
print(json.dumps(summary, ensure_ascii=False))
zip_out = HERE / 'radish_hires_crops.zip'
if zip_out.exists():
    zip_out.unlink()
shutil.make_archive(str(zip_out.with_suffix('')), 'zip', root_dir=HERE, base_dir='radish_hires_crops')
print('zip', zip_out, round(zip_out.stat().st_size / 1e6, 1), 'MB')
shutil.rmtree(TMP, ignore_errors=True)
