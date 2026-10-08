"""Attach manually inspected notes and audit all validation metadata; no training/inference."""
import csv, json, html, hashlib
from pathlib import Path
from collections import Counter, defaultdict
from PIL import Image

OUT=Path(__file__).resolve().parent
ROOT=OUT.parents[2]
def readcsv(p):
    with p.open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))
def writecsv(p,rows):
    with p.open('w',encoding='utf-8-sig',newline='') as f:
        wr=csv.DictWriter(f,fieldnames=list(rows[0]));wr.writeheader();wr.writerows(rows)
notes=json.loads((OUT/'visual_notes.json').read_text(encoding='utf-8'))
rows=readcsv(OUT/'review.csv');controls=readcsv(OUT/'controls.csv')
assert len(rows)==59 and len(controls)==18 and len(notes)==77
for r in rows+controls:
    r['visual_notes']=notes[r['id']]
    r['review_level']='preview_and_256_input'
    if r['id'] in ['E06','E30','E53','E59']:r['review_level']='plus_large_display_of_original'
    r['label_review']='not adjudicated; keep original label'
    r['next_action']='independent disease/organ review' if r['id']=='E59' else 'controlled input/coverage comparison; no automatic relabel'
writecsv(OUT/'review.csv',rows);writecsv(OUT/'controls.csv',controls)
writecsv(OUT/'new_errors.csv',[r for r in rows if r['change']=='regressed'])
pred=readcsv(ROOT/'output/colab/group256_analysis_20260924/paired_predictions.csv')
manifest=readcsv(ROOT/'output/colab/group_baseline_20260921/manifest.csv')
mapping={r['bundle_path'].removeprefix('dataset/val/'):r for r in manifest if r['candidate_split']=='val'}
labels={r['path']:r['data'] for r in json.loads((ROOT/'output/colab/full_label_audit_20260921/matched_labels.json').read_text(encoding='utf-8'))}
expected={0:(1,1),1:(1,2),2:(2,3),3:(2,4),4:(3,5),5:(3,6),6:(1,0),7:(2,0),8:(3,0)}
stats=defaultdict(Counter);orientations=Counter();code_errors=[];total_cm=[[0]*9 for _ in range(9)]
for p in pred:
    m=mapping[p['path']];label=labels[m['path']];desc=label['description'];ann=label['annotations']
    a,b=int(p['actual']),int(p['predicted']);wrong=int(a!=b);total_cm[a][b]+=1
    if (int(ann['crop']),int(ann['disease']))!=expected[a]:code_errors.append(p['path'])
    with Image.open(ROOT/m['path']) as im:w,h=im.size;orientation=im.getexif().get(274,1)
    orientations[str(orientation)]+=1
    categories=['all',f'class_{a}',f'class_{a}_'+('dimension_match' if (w,h)==(desc['width'],desc['height']) else 'dimension_mismatch'),f'aspect_{w/h:.2f}', 'score_ge_09' if float(p['score'])>=.9 else 'score_lt_09']
    for key in categories:stats[key]['total']+=1;stats[key]['errors']+=wrong
assert total_cm==json.loads((ROOT/'output/colab/group256_analysis_20260924/val_metrics.json').read_text())['confusion_matrix']
assert not code_errors
summary=json.loads((OUT/'summary.json').read_text())
summary['metadata_audit']={k:dict(v,error_rate=v['errors']/v['total']) for k,v in sorted(stats.items())}
summary['val_exif_orientation']=dict(orientations)
summary['label_code_errors']=code_errors
summary['regression_by_class']=dict(Counter(r['actual'] for r in rows if r['change']=='regressed'))
summary['reviewed_images']=len(notes)
summary['input_checksums']={p.relative_to(ROOT).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in [ROOT/'output/colab/group256_analysis_20260924/paired_predictions.csv',ROOT/'output/colab/group_baseline_20260921/manifest.csv',OUT/'visual_notes.json']}
summary['audit_scope']='785 validation metadata; 59 error + 18 correct preview comparisons; four originals displayed larger; no test evaluation or model inference'
(OUT/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
cards=[]
for r in rows+controls:
    original='../../../'+r['original_path']
    assert (OUT/original).resolve().exists() and (OUT/f'{r["id"]}.jpg').exists()
    cards.append(f'<article id="{r["id"]}" data-kind="{r["kind"]}" data-new="{r["change"]}" data-high="{int(float(r["score"])>=.9)}"><h2>{r["id"]} · {html.escape(r["change"])}</h2><a href="{html.escape(original)}"><img loading="lazy" src="{r["id"]}.jpg"></a><p>{html.escape(r["visual_notes"])}</p><p>ラベル / 라벨 일치: {r["label_consistent"]}; 라벨 치수 일치: {r["dimension_match"]}; 원인 확정·병명 재판정 안 함</p><a href="{html.escape(original)}">원본 보기</a></article>')
page='''<!doctype html><html lang="ko"><meta charset="utf-8"><title>256 오류 검토 59장</title><style>body{font:16px/1.6 sans-serif;max-width:1400px;margin:24px auto;padding:0 16px;background:#f5f6f7;color:#182128}main{display:flex;flex-wrap:wrap;gap:18px}article{width:min(660px,100%);padding:12px;background:white;border:1px solid #ddd;border-radius:8px;box-sizing:border-box}img{width:100%}select{font:inherit;padding:8px}a{color:#075fa0}article[hidden]{display:none}</style><h1>256 오류 59장 원인 검토</h1><p>왼쪽: 원본 비율 미리보기. 오른쪽: RGB 256×256 정규화 전(표시용 JPEG). 클릭하면 로컬 원본. 정답 대조군 18장은 오류가 있는 클래스·작업자 조합별 경로 SHA256 정렬 첫 2장이다. 병명은 재판정하지 않았다.</p><p>0 고추탄저병 / 1 고추흰가루병 / 2 무검은무늬병 / 3 무노균병 / 4 배추검은썩음병 / 5 배추노균병 / 6 고추정상 / 7 무정상 / 8 배추정상</p><p>regressed: 224 정답→256 오답. 오류의 unchanged: 두 모델 모두 오답(예측 클래스까지 같다는 뜻은 아님). 높은 점수는 정답 보장이 아니다.</p><label>보기 <select id="filter"><option value="all">전체 77장</option><option value="error">오류 59장</option><option value="regressed">새 오류 12장</option><option value="high">0.9 이상 오답 15장</option><option value="correct_control">정답 대조군 18장</option></select></label><p id="count"></p><p><a href="report.md">분석 보고서</a> · <a href="review.csv">표본별 CSV</a></p><main>'''+''.join(cards)+'''</main><script>const f=document.getElementById('filter');function update(){let n=0;for(const a of document.querySelectorAll('article')){const v=f.value;const show=v==='all'||a.dataset.kind===v||(v==='regressed'&&a.dataset.new===v)||(v==='high'&&a.dataset.kind==='error'&&a.dataset.high==='1');a.hidden=!show;n+=show;}document.getElementById('count').textContent=n+'장 표시';}f.addEventListener('change',update);update();</script></html>'''
(OUT/'index.html').write_text(page,encoding='utf-8')
lines=['# 256 오류 59장 표본별 관찰','', '모든 관찰은 원인 가설을 위한 기록이며 병명 재판정·인과관계 확정이 아니다. 사진은 로컬 자료가 필요하다.','', '| ID | 실제→256 예측 | 224 예측 | 새 오류 | 점수 | 관찰 |','|---|---|---|---|---:|---|']
for r in rows:lines.append(f'| [{r["id"]}](index.html#{r["id"]}) | {r["actual"]}→{r["predicted"]} | {r["previous"]} | {"예" if r["change"]=="regressed" else "아니오"} | {float(r["score"]):.3f} | {r["visual_notes"]} |')
(OUT/'sample_review.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print(json.dumps({k:summary[k] for k in ['regression_by_class','val_exif_orientation','metadata_audit']},ensure_ascii=False,indent=2))
