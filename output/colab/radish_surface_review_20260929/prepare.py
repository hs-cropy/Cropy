import csv,hashlib,json
from pathlib import Path
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[3]; OUT=ROOT/'output/colab/radish_surface_review_20260929';OUT.mkdir(exist_ok=True)
old=list(csv.DictReader((ROOT/'output/colab/radish_train_coverage_20260928/sample_review.csv').open(encoding='utf-8-sig')))
seen={r['original_path']:r for r in old}
manifest=list(csv.DictReader((ROOT/'output/colab/group_baseline_20260921/manifest.csv').open(encoding='utf-8-sig')))
train=sorted([r for r in manifest if r['candidate_split']=='train' and r['class'].startswith(('2_','3_'))],key=lambda r:(r['class'],r['filename_worker'],r['date'],r['path']))
remaining=[r for r in train if r['path'] not in seen];assert len(remaining)==448
rows=[]
for i,r in enumerate(remaining,1):
    ident=f'R{i:03}';path=ROOT/r['path'];assert hashlib.sha256(path.read_bytes()).hexdigest()==r['sha256']
    with Image.open(path) as im:im=im.convert('RGB');im.thumbnail((342,234))
    tile=Image.new('RGB',(350,280),'white');tile.paste(im,((350-im.width)//2,25+(234-im.height)//2));d=ImageDraw.Draw(tile)
    d.text((5,4),f'{ident} c={r["class"][0]} w={r["filename_worker"]}',fill='black');d.text((5,263),r['date'],fill='black')
    tile.save(OUT/f'{ident}.jpg',quality=92)
    rows.append(dict(id=ident,actual=r['class'][0],worker=r['filename_worker'],date=r['date'],original_path=r['path'],sha256=r['sha256'],surface='pending',source='visual_review_20260929'))
with (OUT/'remaining.csv').open('w',encoding='utf-8-sig',newline='') as f:
    wr=csv.DictWriter(f,fieldnames=list(rows[0]));wr.writeheader();wr.writerows(rows)
for start in range(0,448,16):
    sheet=Image.new('RGB',(1400,1120),'#ddd')
    for j,r in enumerate(rows[start:start+16]):
        with Image.open(OUT/f'{r["id"]}.jpg') as im:sheet.paste(im,((j%4)*350,(j//4)*280))
    sheet.save(OUT/f'contact_{start//16+1:02}.jpg',quality=93)
print('Prepared 448 samples / 28 sheets; no test images opened')

