import csv,json,hashlib,html
from pathlib import Path
from collections import defaultdict,Counter
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[3]; OUT=ROOT/'output/colab/radish_train_coverage_20260928';OUT.mkdir(exist_ok=True)
manifest=ROOT/'output/colab/group_baseline_20260921/manifest.csv'
assert hashlib.sha256(manifest.read_bytes()).hexdigest()=='d0fda6ef2e51b7ea1a201941e10dadea2f8e6b33eca785735b3d0dec58620e72'
rows=list(csv.DictReader(manifest.open(encoding='utf-8-sig')))
train=[r for r in rows if r['candidate_split']=='train' and r['class'].startswith(('2_','3_'))]
labels={r['path']:r['data'] for r in json.loads((ROOT/'output/colab/full_label_audit_20260921/matched_labels.json').read_text(encoding='utf-8'))}
groups=defaultdict(list);ws=defaultdict(Counter);issues=[]
for r in train:
    a=int(r['class'][0]);key=(a,r['filename_worker'],r['date']);groups[key].append(r)
    label=labels[r['path']];desc=label['description'];ann=label['annotations']
    assert (int(ann['crop']),int(ann['disease']))==(2,a+1)
    with Image.open(ROOT/r['path']) as im:w,h=im.size
    s=ws[(a,r['filename_worker'])];s['images']+=1;s['dimension_mismatch']+=int((w,h)!=(desc['width'],desc['height']))
    if (w,h)!=(desc['width'],desc['height']):issues.append(dict(path=r['path'],width=w,height=h,label_width=desc['width'],label_height=desc['height']))
selected=[]
for key,items in sorted(groups.items()):
    r=min(items,key=lambda r:hashlib.sha256(r['path'].encode()).hexdigest());ident=f'T{len(selected)+1:02}'
    path=ROOT/r['path'];assert hashlib.sha256(path.read_bytes()).hexdigest()==r['sha256']
    with Image.open(path) as im:rgb=im.convert('RGB');w,h=im.size
    tile=Image.new('RGB',(480,350),'white');d=ImageDraw.Draw(tile)
    d.text((6,6),f'{ident} class={key[0]} worker={key[1]} {key[2]} n={len(items)}',fill='black')
    rgb.thumbnail((468,290));tile.paste(rgb,((480-rgb.width)//2,28+(290-rgb.height)//2))
    d.text((6,328),f'{w}x{h} | train only | click original',fill='black');tile.save(OUT/f'{ident}.jpg',quality=94)
    selected.append(dict(id=ident,actual=key[0],worker=key[1],date=key[2],group_images=len(items),original_path=r['path'],sha256=r['sha256'],surface='pending',framing='pending',features='pending',environment='pending'))
def writecsv(name,items):
    with (OUT/name).open('w',encoding='utf-8-sig',newline='') as f:wr=csv.DictWriter(f,fieldnames=list(items[0]));wr.writeheader();wr.writerows(items)
writecsv('sample_review.csv',selected)
writecsv('group_counts.csv',[dict(actual=k[0],worker=k[1],date=k[2],images=len(v)) for k,v in sorted(groups.items())])
writecsv('worker_counts.csv',[dict(actual=k[0],worker=k[1],**s,date_groups=sum(g[:2]==k for g in groups)) for k,s in sorted(ws.items())])
for start in range(0,len(selected),9):
    sheet=Image.new('RGB',(1440,1050),'#ddd')
    for i,r in enumerate(selected[start:start+9]):
        with Image.open(OUT/f'{r["id"]}.jpg') as im:sheet.paste(im,((i%3)*480,(i//3)*350))
    sheet.save(OUT/f'contact_{start//9+1:02}.jpg',quality=93)
summary=dict(train_images=len(train),class_counts=dict(Counter(r['class'][0] for r in train)),groups=len(groups),sample_images=len(selected),unique_hashes=len({r['sha256'] for r in train}),metadata_mismatches=len(issues),workers=[dict(actual=k[0],worker=k[1],**s,date_groups=sum(g[:2]==k for g in groups)) for k,s in sorted(ws.items())],scope='train classes 2/3 only; one path-hash-selected image per class/worker/date group; no test images read')
(OUT/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(summary,ensure_ascii=False))
