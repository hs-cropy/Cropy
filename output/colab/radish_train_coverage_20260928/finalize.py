import csv,json,html
from pathlib import Path
from collections import Counter
OUT=Path(__file__).resolve().parent;ROOT=OUT.parents[2]
rows=list(csv.DictReader((OUT/'sample_review.csv').open(encoding='utf-8-sig')))
notes={}
for line in (OUT/'observations.txt').read_text(encoding='utf-8').splitlines():
    k,*v=line.split('|');assert len(v)==4;notes[k]=v
assert len(rows)==len(notes)==65
for r in rows:
    for key,value in zip(['surface','framing','features','environment'],notes[r['id']]):r[key]=value
with (OUT/'sample_review.csv').open('w',encoding='utf-8-sig',newline='') as f:
    wr=csv.DictWriter(f,fieldnames=list(rows[0]));wr.writeheader();wr.writerows(rows)
summary=json.loads((OUT/'summary.json').read_text())
summary['sample_counts']={c:{k:dict(Counter(r[k] for r in rows if r['actual']==c)) for k in ['surface','framing']} for c in ['2','3']}
manifest=list(csv.DictReader((ROOT/'output/colab/group_baseline_20260921/manifest.csv').open(encoding='utf-8-sig')))
tr=[r for r in manifest if r['candidate_split']=='train' and r['class'].startswith(('2_','3_'))]
va=[r for r in manifest if r['candidate_split']=='val' and r['class'].startswith(('2_','3_'))]
assert not ({r['sha256'] for r in tr}&{r['sha256'] for r in va})
assert not ({r['filename_worker'] for r in tr}&{r['filename_worker'] for r in va})
summary['train_val_worker_overlap']=0;summary['train_val_exact_hash_overlap']=0
(OUT/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
cards=[]
for r in rows:
    link='../../../'+r['original_path'];assert (OUT/link).resolve().exists()
    cards.append(f'<article data-class="{r["actual"]}"><h2>{r["id"]} · {r["worker"]} · {r["date"]}</h2><a href="{html.escape(link)}"><img loading="lazy" src="{r["id"]}.jpg"></a><p>{r["surface"]} / {r["framing"]}</p><p>{r["features"]} / {r["environment"]}</p><p>同 / 같은 클래스·작업자·날짜 묶음 {r["group_images"]}장 중 1장. 특징이 나머지 사진에도 같다는 의미는 아님.</p></article>')
page='''<!doctype html><html lang="ko"><meta charset="utf-8"><title>무 병해 학습 데이터 검토</title><style>body{font:16px/1.6 sans-serif;background:#f4f6f5;color:#172b24;padding:24px}main{display:flex;flex-wrap:wrap;gap:18px}article{background:white;border:1px solid #ccc;padding:12px;width:480px;box-sizing:border-box}img{width:100%}article[hidden]{display:none}select{font:inherit;padding:6px}</style><h1>무 병해 train 513장 분포·표본 65장 검토</h1><p>클래스·작업자·날짜별 경로 해시 정렬 첫 1장을 선정. 촬영면은 육안 추정이며 병명 재판정 아님. 이미지 클릭: 로컬 원본.</p><a href="report.md">분석 보고서</a><p><select id="filter"><option value="all">전체</option><option value="2">무검은무늬병</option><option value="3">무노균병</option></select></p><main>'''+''.join(cards)+'''</main><script>document.getElementById('filter').addEventListener('change',e=>{for(const a of document.querySelectorAll('article'))a.hidden=e.target.value!=='all'&&a.dataset.class!==e.target.value;});</script></html>'''
(OUT/'index.html').write_text(page.replace('同 / ',''),encoding='utf-8')
lines=['# 학습 표본 65장 관찰','', '촬영면은 추정이며, 병징이라는 확정 대신 보이는 특징을 기록했다. 표본을 전체 학습 분포로 환산하지 않는다.','', '| ID | 클래스 | 작업자 | 날짜 | 촬영면 | 구도 | 보이는 특징 | 환경 |','|---|---|---|---|---|---|---|---|']
for r in rows:lines.append('| '+' | '.join([r['id'],r['actual'],r['worker'],r['date'],r['surface'],r['framing'],r['features'],r['environment']])+' |')
(OUT/'sample_review.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print(json.dumps(summary['sample_counts'],ensure_ascii=True,indent=2))
