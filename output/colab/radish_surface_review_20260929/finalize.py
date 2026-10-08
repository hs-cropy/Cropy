import csv, hashlib, html, json
from collections import Counter
from pathlib import Path
from PIL import Image

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]
def read(p):
    with p.open(encoding='utf-8-sig', newline='') as f: return list(csv.DictReader(f))
def write(name, rows):
    with (OUT/name).open('w', encoding='utf-8-sig', newline='') as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)

old=read(OUT.parent/'radish_train_coverage_20260928/sample_review.csv')
remaining=read(OUT/'remaining.csv')
blocks=json.loads((OUT/'surface_blocks.json').read_text())
assert len(blocks)==28 and all(len(b)==16 and set(b)<=set('BFU') for b in blocks)
codes=''.join(blocks)
tags={'B':'뒷면 추정','F':'앞면 추정','U':'판단 불가'}
rows=[]
for r in old:
    rows.append({k:r[k] for k in ['id','actual','worker','date','original_path','sha256','surface']})
    rows[-1]['source']='visual_review_20260928'
for r,c in zip(remaining,codes):
    r['surface']=tags[c]; rows.append(r)
manifest=read(OUT.parent/'group_baseline_20260921/manifest.csv')
train={r['path']:r for r in manifest if r['candidate_split']=='train' and r['class'].startswith(('2_','3_'))}
assert len(rows)==513 and len({r['original_path'] for r in rows})==513
assert {r['original_path'] for r in rows}==set(train)
for r in rows:
    assert r['surface'] in tags.values(), r
    assert r['actual']==train[r['original_path']]['class'][0]
    assert r['sha256']==train[r['original_path']]['sha256']==hashlib.sha256((ROOT/r['original_path']).read_bytes()).hexdigest()
    r['expert_status']='전문가 미검수'
write('surface_review.csv',rows)
counts=Counter((r['actual'],r['surface']) for r in rows)
workers=Counter((r['actual'],r['worker'],r['surface']) for r in rows)
write('worker_surface_counts.csv',[dict(actual=a,worker=w,surface=s,count=n) for (a,w,s),n in sorted(workers.items())])
summary={'images':len(rows),'newly_reviewed':448,'previously_reviewed':65,'hash_matches':513,'unique_paths':513,'counts':[{ 'actual':a,'surface':s,'count':n} for (a,s),n in sorted(counts.items())],'expert_status':'pending','test_images_opened':0}
(OUT/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')

# Purposive candidates; preserve train/validation separation and original labels.
errors={r['id']:r for r in read(OUT.parent/'error_review_256_20260928/review.csv')}
train_ids=['T15','T26','T29','T52','T53','T57','T22','T54','T34','T50','T33','T63']
val_ids=['E11','E14','E23','E29','E30','E36','E37','E43']
lookup={r['id']:r for r in old};lookup.update(errors)
ids=sorted(train_ids+val_ids,key=lambda s:hashlib.sha256(s.encode()).hexdigest())
candidates=[]; forms=[]; cards=[]
all_manifest={r['path']:r for r in manifest}
for n,ident in enumerate(ids,1):
    r=lookup[ident]; q=f'Q{n:02}'; split='train' if ident in train_ids else 'val'
    m=all_manifest[r['original_path']];assert m['candidate_split']==split
    assert hashlib.sha256((ROOT/r['original_path']).read_bytes()).hexdigest()==m['sha256']
    if ident in ['T15','T26','T29','T52','T53','T57']: reason='갈색·밝은 국소 변화가 두 라벨에서 관찰된 후보: 구분 근거 검토'
    elif ident in ['T22','T54']: reason='앞면 추정 사진에서 병해를 구분할 근거 검토'
    elif ident in ['T34','T50']: reason='병징이 약하게 보이는 사진의 진단 가능 여부 검토'
    elif ident in ['T33','T63']: reason='그림자가 있는 사진에서 병징 관찰 가능 여부 검토'
    else: reason='256 모델의 무 병해 검증 오류: 라벨 적합성·가시 병징 검토'
    question='촬영면은 무엇인가? 사진만으로 진단 가능한가? 구분 근거 부위와 다른 가능한 원인은? 추가 촬영이 필요한가?'
    candidates.append(dict(id=q,source_id=ident,split=split,actual=r['actual'],prediction=r.get('predicted',''),reason=reason,question=question,original_path=r['original_path'],sha256=m['sha256']))
    forms.append(dict(id=q,surface='',diagnosis='',diagnostic_evidence='',alternative_cause='',certainty='',additional_photo_needed='',reviewer='',review_date=''))
    with Image.open(ROOT/r['original_path']) as im:
        im=im.convert('RGB');im.thumbnail((1600,1600));im.save(OUT/f'{q}.jpg',quality=95)
    cards.append(f'<article><h2>{q}</h2><a href="{q}.jpg"><img loading="lazy" src="{q}.jpg" alt="{q}"></a></article>')
write('expert_candidates.csv',candidates)
# Do not overwrite a completed review form on rerun.
if not (OUT/'expert_review_form.csv').exists():write('expert_review_form.csv',forms)
(OUT/'expert_gallery.html').write_text('<!doctype html><html lang="ko"><meta charset="utf-8"><title>무 병해 전문가 검수</title><style>body{max-width:1000px;margin:30px auto;font-family:sans-serif}img{max-width:100%;max-height:850px}article{margin:40px 0}</style><h1>무 병해 전문가 검수 20장</h1><p>이미지 ID별로 expert_review_form.csv에 독립 의견을 작성하세요. 진단 불가도 유효한 답변입니다. 기존 라벨·예측·선정 사유는 expert_candidates.csv에 별도 보관합니다. 이미지는 최대 1600px 미리보기이며 원본은 별도 참조표 경로에 있습니다.</p>'+''.join(cards)+'</html>',encoding='utf-8')
table=['| 병해(기존 라벨) | 앞면 추정 | 뒷면 추정 | 판단 불가 | 합계 |','|---|---:|---:|---:|---:|']
for a,name in [('2','무검은무늬병'),('3','무노균병')]:
    nums=[counts[a,tags[c]] for c in 'FBU'];table.append('| '+name+' | '+' | '.join(map(str,nums+[sum(nums)]))+' |')
worker_table=['| 라벨 | 작업자 | 앞면 추정 | 뒷면 추정 | 판단 불가 |','|---|---|---:|---:|---:|']
for a,w in sorted({(r['actual'],r['worker']) for r in rows}):worker_table.append(f'| {a} | {w} | '+' | '.join(str(workers[a,w,tags[c]]) for c in 'FBU')+' |')
report='''# 무 병해 학습 데이터 촬영면 전수 1차 검토 및 전문가 검수 준비

작성일: 2026-09-29. 상태: AI 시각 검토 완료, 전문가 검수 미실시.

## 범위와 방법

현재 group baseline manifest의 candidate_split=train인 무 병해 513장만 촬영면 집계에 사용했다. 기존 65장 관찰에 남은 448장(R001~R448)을 추가했다. 기존 폴더 이름(train/val/test)은 과거 분할이며 현재 분할은 manifest를 기준으로 한다. 현재 test 이미지는 열지 않았다.

기존 65장은 이전 관찰을 재사용했고, 448장은 원본 비율의 최대 342×234 미리보기를 16장씩 28개 시트로 육안 검토했다. 뚜렷하게 돌출된 잎맥 등 외형으로 앞면·뒷면을 추정하고, 접힘·겹침 등으로 불명확한 경우 판단 불가로 기록했다. 단일 AI 검토자의 임시 태그이며 전문가 정답이나 독립 검수자 간 일치도 측정은 아니다. 특히 작은 미리보기의 면 판별 오류 가능성이 있어 학습 라벨로 직접 사용하지 않는다.

## 전체 촬영면 분포

'''+ '\n'.join(table)+'''

두 병해 모두 앞면·뒷면 추정 사진이 존재한다. 따라서 특정 촬영면이 학습 데이터에 전혀 없다는 설명은 지지되지 않는다. 그러나 뒷면 편중과 작업자별 구성 차이가 있어 현장 촬영 조건을 충분히 대표한다고 결론낼 수 없다. 사진 수는 독립 개체 수가 아니며 동일 잎·연속 촬영 여부는 확인되지 않았다.

## 작업자별 분포

라벨 2=무검은무늬병, 3=무노균병. 작업자는 파일명의 수집자 코드이며 농장·개체 ID로 간주하지 않는다.

'''+ '\n'.join(worker_table)+'''

## 병징·환경에 대해 확인한 범위

촬영면만 513장 전수 태깅했다. 병징·환경의 정량 분포는 전수 태깅하지 않았으며 [기존 65장 조사](../radish_train_coverage_20260928/report.md)의 관찰 수준이다. 구멍, 갈색 점, 밝은 국소 변화, 손, 주변 잎, 그림자 등이 두 라벨에 나타난다는 사실은 특정 병해의 확진 근거가 아니다. 환경·병징이 충분히 포함됐는지에 대한 최종 판정은 아직 유보한다.

## 전문가 검수 묶음

학습 12장과 이미 분석한 검증 오류 8장, 총 20장을 목적 표집했다. 혼동 사례를 검토하기 위한 선정이므로 병해 유병률이나 라벨 오류율을 추정할 수 없다. Q01~Q20 순서는 ID 해시로 고정했다. 갤러리에는 기존 라벨·모델 점수를 노출하지 않고 참조표를 분리했다. 원본 경로를 열면 라벨이 보일 수 있으므로 완전한 눈가림은 아니다.

- [검수 이미지 갤러리](expert_gallery.html): 먼저 독립 관찰
- [빈 검수 양식](expert_review_form.csv): 촬영면, 진단 또는 진단 불가, 근거 부위, 대안 원인, 확신 수준, 추가 촬영 요구 기록
- [선정 사유·기존 라벨·원본 경로](expert_candidates.csv): 독립 검토 후 대조
- [전체 촬영면 태그 513장](surface_review.csv), [작업자별 집계](worker_surface_counts.csv), [검증 결과](summary.json)

전문가에게 전달하거나 회신을 받은 상태는 아니다. 병해 라벨, 학습 데이터, 모델을 변경하지 않았다. 검증 오류 이미지를 학습 데이터로 옮기지 않았다.

## 다음 판단 절차

1. 전문가가 20장에 대해 진단 가능 여부와 구분 근거를 작성한다. 진단 불가를 정상으로 치환하지 않는다.
2. 앞면·뒷면 추정 및 판단 불가 태그를 원본 해상도로 교차 검수하고, 불일치 사유를 남긴다.
3. 확정된 병징 정의로 전체 데이터의 병징·조명·거리·가림 정도를 추가 태깅한다. 부족한 조합은 여러 작업자·농장·개체에서 같은 잎의 앞뒷면과 근접/전체 사진을 수집하는 후보로 삼는다.
4. 추가 수집·라벨 변경은 근거를 남겨 별도 버전으로 관리하고, 기존 검증 세트와 분리해 효과를 평가한다. 이번 작업만으로 정확도 개선 효과를 주장하지 않는다.

## 검증

전체 513개 경로가 현재 train 무 병해 목록과 정확히 일치하고 중복 경로가 없다. 513개 원본 SHA-256이 manifest와 일치한다. 추가 448개 태그에 누락이 없다. 검수 후보 20장의 원본 해시와 현재 분할(train 12 / val 8)도 대조했다. 재집계: 이 폴더의 finalize.py를 실행한다. 이미지 파일은 로컬 산출물이며 GitHub에 공개하지 않았다.
'''
(OUT/'report.md').write_text(report,encoding='utf-8')
print(json.dumps(summary,ensure_ascii=False))
print('Expert candidates:',Counter(r['split'] for r in candidates))
