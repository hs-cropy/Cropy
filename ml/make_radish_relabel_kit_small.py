"""농진청 문의용 소량 키트: 기존 radish_relabel_kit(789장)에서 시험셋 50장을 골라 radish_relabel_kit_small/ 생성.

선정(시험셋 290장, Claude 육안 코드 radish_audit_v1.json 기준):
  G1 AI Hub 검은무늬병 라벨인데 노균 양상(A)           최대 20장, 모델이 노균이라 한 사진 우선
  G2 AI Hub 노균병 라벨인데 검은무늬 양상(B/Bf)        최대 10장
  G3 AI Hub 검은무늬병 라벨인데 병반 안 보임(D)         10장
  G4 라벨·양상 일치 대조군(검은무늬 B 5장, 노균 A 5장)   10장
전문가에게는 모델 예측·Claude 코드를 보여 주지 않는다(편향 방지). 내부 대조용 key.csv는 키트 밖에 둔다.
"""
import csv, json, random, re, shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / 'radish_relabel_kit'
OUT = HERE / 'radish_relabel_kit_small'
audit = json.load((HERE / 'radish_audit_v1.json').open(encoding='utf-8'))
pat = audit['test_pattern']
rows = {r['id']: r for r in csv.DictReader((SRC / 'review_sheet.csv').open(encoding='utf-8-sig')) if r['split'] == 'test'}
assert len(rows) == 290

def pick(ids, n, seed):
    ids = sorted(ids); random.Random(seed).shuffle(ids); return ids[:n]

g = {}
g1 = [i for i, r in rows.items() if r['aihub_label'] == '무검은무늬병' and pat.get(i) == 'A']
g1_disp = [i for i in g1 if rows[i]['disputed'] == '1']
g['G1'] = pick(g1_disp, 20, 1) + pick([i for i in g1 if i not in g1_disp], max(0, 20 - len(g1_disp)), 2)
g['G2'] = pick([i for i, r in rows.items() if r['aihub_label'] == '무노균병' and pat.get(i) in ('B', 'Bf')], 10, 3)
g['G3'] = pick([i for i, r in rows.items() if r['aihub_label'] == '무검은무늬병' and pat.get(i) == 'D'], 10, 4)
g['G4'] = pick([i for i, r in rows.items() if r['aihub_label'] == '무검은무늬병' and pat.get(i) == 'B' and r['disputed'] == '0'], 5, 5) + \
          pick([i for i, r in rows.items() if r['aihub_label'] == '무노균병' and pat.get(i) == 'A' and r['disputed'] == '0'], 5, 6)
print({k: len(v) for k, v in g.items()}, 'pool', {'G1': len(g1), 'G1_disp': len(g1_disp)})

sel = [(i, grp) for grp, ids in g.items() for i in ids]
random.Random(7).shuffle(sel)  # 전문가에게는 섞어서 제시

if OUT.exists():
    shutil.rmtree(OUT)
(OUT / 'images' / 'crop').mkdir(parents=True); (OUT / 'images' / 'full').mkdir(parents=True)
items = []
for seq, (i, grp) in enumerate(sel, 1):
    r = rows[i]
    for sub in ('crop', 'full'):
        shutil.copyfile(SRC / 'images' / sub / f'{i}.jpg', OUT / 'images' / sub / f'{i}.jpg')
    items.append(dict(seq=seq, id=i, label_kor=r['aihub_label'], worker=r['worker'], date=r['date'], risk=r['risk'], split='test',
                      has_box=r['has_box'] == '1', group=grp, model_pred=r['model_pred_448'], model_conf=r['model_conf'], claude_code=pat.get(i, '')))

with (OUT / 'review_sheet.csv').open('w', newline='', encoding='utf-8-sig') as f:
    w = csv.writer(f)
    w.writerow(['seq', 'id', 'aihub_label', 'date', 'risk', 'reviewer_label', 'reviewer_note'])
    for d in items:
        w.writerow([d['seq'], d['id'], d['label_kor'], d['date'], d['risk'], '', ''])
with (HERE / 'radish_relabel_kit_small_key.csv').open('w', newline='', encoding='utf-8-sig') as f:
    w = csv.writer(f)
    w.writerow(['seq', 'id', 'aihub_label', 'group', 'claude_code', 'model_pred_448', 'model_conf'])
    for d in items:
        w.writerow([d['seq'], d['id'], d['label_kor'], d['group'], d['claude_code'], d['model_pred'], d['model_conf']])

html_src = (SRC / 'review.html').read_text(encoding='utf-8')
slim = [{k: d[k] for k in ('seq', 'id', 'label_kor', 'worker', 'date', 'risk', 'split', 'has_box')} for d in items]
html_out = re.sub(r'const ITEMS = .*?;\n', 'const ITEMS = ' + json.dumps(slim, ensure_ascii=False) + ';\n', html_src, count=1, flags=re.S)
html_out = html_out.replace("const KEY = 'radish_relabel_v1';", "const KEY = 'radish_relabel_small_v1';")
html_out = html_out.replace('a.download = \'radish_relabel_result.csv\'', 'a.download = \'radish_relabel_result_small.csv\'')
assert html_out != html_src
(OUT / 'review.html').write_text(html_out, encoding='utf-8')
(OUT / 'README.txt').write_text(
    '무 질병(검은무늬병·노균병) 공개 데이터 라벨 검토 요청 (사진 %d장)\n\n' % len(items) +
    '1. review.html을 브라우저(크롬/엣지)로 엽니다. 인터넷 연결은 필요 없습니다.\n'
    '2. 왼쪽은 병반을 원본 해상도로 잘라 낸 사진, 오른쪽은 전체 사진입니다. 모두 잎 앞면 사진입니다.\n'
    '3. 사진마다 1~5 버튼(또는 숫자 키)으로 판정합니다. 판정하면 다음 사진으로 넘어갑니다.\n'
    '   1 검은무늬병 / 2 노균병 / 3 혼합(두 병 모두) / 4 판정불가(사진만으로 알 수 없음) / 5 질병 아님·다른 문제\n'
    '4. 화면의 "AI Hub 라벨"은 공개 데이터셋에 붙어 있던 라벨입니다. 라벨이 맞는지 보는 것이 목적이므로 다르게 보이면 그대로 눌러 주세요.\n'
    '5. 판정은 브라우저에 자동 저장됩니다. 끝나면 "CSV 내보내기"를 눌러 radish_relabel_result_small.csv를 회신해 주세요.\n'
    '6. 브라우저 사용이 어려우면 review_sheet.csv의 reviewer_label 칸에 1~5 번호를 적어 주셔도 됩니다.\n',
    encoding='utf-8')
zip_out = HERE / 'radish_relabel_kit_small.zip'
if zip_out.exists():
    zip_out.unlink()
shutil.make_archive(str(zip_out.with_suffix('')), 'zip', root_dir=HERE, base_dir='radish_relabel_kit_small')
print('images', len(items), 'zip', round(zip_out.stat().st_size / 1e6, 1), 'MB')
