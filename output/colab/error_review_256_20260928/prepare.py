import csv,json,hashlib,html
from pathlib import Path
from collections import Counter,defaultdict
from PIL import Image,ImageDraw

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'output/colab/error_review_256_20260928'
OUT.mkdir(exist_ok=True)
def readcsv(p):
    with p.open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))
pred=readcsv(ROOT/'output/colab/group256_analysis_20260924/paired_predictions.csv')
manifest=readcsv(ROOT/'output/colab/group_baseline_20260921/manifest.csv')
assert hashlib.sha256((ROOT/'output/colab/group_baseline_20260921/manifest.csv').read_bytes()).hexdigest()=='d0fda6ef2e51b7ea1a201941e10dadea2f8e6b33eca785735b3d0dec58620e72'
mapping={r['bundle_path'].removeprefix('dataset/val/'):r for r in manifest if r['candidate_split']=='val'}
labels={r['path']:r['data'] for r in json.loads((ROOT/'output/colab/full_label_audit_20260921/matched_labels.json').read_text(encoding='utf-8'))}
assert len(pred)==len(mapping)==785 and len({p['path'] for p in pred})==785
errors=[p for p in pred if p['actual']!=p['predicted']]
assert len(errors)==59
old={Path(r['original_path']).name for r in readcsv(ROOT/'output/colab/error_review_20260922/review.csv')}
stats=defaultdict(Counter)
controls=defaultdict(list)
for p in pred:
    m=mapping[p['path']]; k=(int(p['actual']),m['filename_worker'])
    stats[k]['total']+=1;stats[k]['errors']+=p['actual']!=p['predicted']
    if p['actual']==p['predicted']:controls[k].append(p)
rows=[]
def make_row(p,ident,kind):
    m=mapping[p['path']];path=ROOT/m['path'];label=labels[m['path']]
    desc,ann=label['description'],label['annotations']
    assert int(m['class'].split('_')[0])==int(p['actual'])
    with Image.open(path) as im:
        im.load();w,h=im.size;rgb=im.convert('RGB')
    boxes=ann.get('points',[])
    valid=bool(boxes) and all(0<=b['xtl']<b['xbr']<=w and 0<=b['ytl']<b['ybr']<=h for b in boxes)
    fractions=[(b['xbr']-b['xtl'])*(b['ybr']-b['ytl'])/(w*h) for b in boxes]
    row=dict(id=ident,kind=kind,**p,worker=m['filename_worker'],date=m['date'],original_path=m['path'],width=w,height=h,aspect_ratio=w/h,label_width=desc['width'],label_height=desc['height'],dimension_match=(w==desc['width'] and h==desc['height']),label_crop=ann['crop'],label_disease=ann['disease'],label_consistent=m['label_consistent'],bbox_count=len(boxes),bbox_valid=valid,bbox_max_area_fraction=max(fractions,default=0),sha256_match=hashlib.sha256(path.read_bytes()).hexdigest()==m['sha256'],previous_visual_review=path.name in old,exif_orientation=Image.open(path).getexif().get(274,1),visual_notes='pending',cause_status='not established')
    assert row['sha256_match']
    tile=Image.new('RGB',(660,325),'white');d=ImageDraw.Draw(tile)
    d.text((5,4),f"{ident} true={p['actual']} old={p['previous']} new={p['predicted']} p={float(p['score']):.3f} {p['change']}",fill='black')
    thumb=rgb.copy();thumb.thumbnail((380,260));tile.paste(thumb,((390-thumb.width)//2,28+(260-thumb.height)//2))
    tile.paste(rgb.resize((256,256),Image.Resampling.BILINEAR),(398,30))
    d.text((5,299),f"{w}x{h} worker={m['filename_worker']} {m['date']} | right:256x256",fill='black')
    tile.save(OUT/f'{ident}.jpg',quality=93)
    return row
for i,p in enumerate(errors,1): rows.append(make_row(p,f'E{i:02}','error'))
control_rows=[]
for k in sorted({(int(r['actual']),r['worker']) for r in rows}):
    choices=sorted(controls[k],key=lambda p:hashlib.sha256(p['path'].encode()).hexdigest())[:2]
    for p in choices:control_rows.append(make_row(p,f'C{len(control_rows)+1:02}','correct_control'))
for filename,items in [('review.csv',rows),('controls.csv',control_rows)]:
    with (OUT/filename).open('w',encoding='utf-8-sig',newline='') as f:
        wr=csv.DictWriter(f,fieldnames=list(items[0]));wr.writeheader();wr.writerows(items)
for prefix,items in [('errors',rows),('controls',control_rows)]:
    for start in range(0,len(items),6):
        sheet=Image.new('RGB',(1320,975),'#dddddd')
        for i,r in enumerate(items[start:start+6]):
            with Image.open(OUT/f'{r["id"]}.jpg') as tile:sheet.paste(tile,((i%2)*660,(i//2)*325))
        sheet.save(OUT/f'{prefix}_{start//6+1:02}.jpg',quality=92)
summary=dict(errors=len(rows),new_errors=sum(r['change']=='regressed' for r in rows),changes=dict(Counter(r['change'] for r in rows)),confusions=dict(Counter(f"{r['actual']}->{r['predicted']}" for r in rows)),dimension_mismatch=[r['id'] for r in rows if not r['dimension_match']],invalid_bbox=[r['id'] for r in rows if not r['bbox_valid']],label_inconsistent=[r['id'] for r in rows if r['label_consistent']!='True'],sha256_all_match=all(r['sha256_match'] for r in rows),high_score_09=[r['id'] for r in rows if float(r['score'])>=.9],already_reviewed=sum(r['previous_visual_review'] for r in rows),controls=len(control_rows),worker_stats=[dict(actual=k[0],worker=k[1],**v,error_rate=v['errors']/v['total']) for k,v in sorted(stats.items())])
(OUT/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
cards=[]
for r in rows+control_rows:
    link='../../../'+r['original_path']
    cards.append(f'<article id="{r["id"]}"><h2>{r["id"]}</h2><a href="{html.escape(link)}"><img src="{r["id"]}.jpg"></a><p>label consistent={r["label_consistent"]}; dimensions match={r["dimension_match"]}; bbox valid={r["bbox_valid"]}</p><p><a href="{html.escape(link)}">原本 / 원본 보기</a></p></article>')
(OUT/'index.html').write_text('<!doctype html><html lang="ko"><meta charset="utf-8"><title>256 오류 59장 검토</title><style>body{font-family:sans-serif;max-width:1400px;margin:auto}main{display:flex;flex-wrap:wrap}article{width:660px;margin:10px}img{width:100%}</style><h1>256 오류 59장과 정답 대조군</h1><p>왼쪽: 원본 비율 미리보기. 오른쪽: 평가 입력 256×256 RGB, 정규화 전. 예측 점수는 정답 확률이 아님. 사진 클릭: 로컬 원본. 정답 대조군은 클래스/작업자별 경로 SHA256 정렬 첫 2장으로 선정. 병명 재판정 아님.</p><p>0 고추탄저병 / 1 고추흰가루병 / 2 무검은무늬병 / 3 무노균병 / 4 배추검은썩음병 / 5 배추노균병 / 6 고추정상 / 7 무정상 / 8 배추정상</p><main>'+''.join(cards)+'</main></html>',encoding='utf-8')
print(json.dumps(summary,ensure_ascii=False,indent=2))
