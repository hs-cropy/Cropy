"""무 질병(검은무늬병·노균병) AI Hub 라벨 재검토 키트 생성.

출력 폴더 radish_relabel_kit/:
  review.html            브라우저에서 열어 판정 (검은무늬병 / 노균병 / 혼합 / 판정불가 / 질병아님), CSV 내보내기
  images/crop/<id>.jpg   원본 해상도 병반 crop (긴 변 1024). 박스가 없는 사진은 전체 사진으로 대체
  images/full/<id>.jpg   전체 사진 (긴 변 768)
  review_sheet.csv       사진 목록 + 메타데이터 + 모델 예측(시험셋만), 검토 결과 기입용 빈 칸
"""
import csv, json, shutil, html
from PIL import Image
from pathlib import Path

HERE = Path(__file__).resolve().parent
FULL512 = Path(r'C:\cropy\data\full\prepared_deduplicated_v1\images')
CROPS = HERE / 'radish_hires_crops'
OUT = HERE / 'radish_relabel_kit'
CLASSES = {'2': '2_무검은무늬병', '3': '3_무노균병'}
KOR = {'2': '무검은무늬병', '3': '무노균병'}

rows = [r for r in csv.DictReader((HERE / 'worker_split_v1.csv').open(encoding='utf-8')) if r['class_id'] in CLASSES]
pred = {}
for r in csv.DictReader((HERE / 'res' / 'predictions_hires448_test.csv').open(encoding='utf-8')):
    if r['label'] in CLASSES:
        p2, p3 = float(r['p2']), float(r['p3'])
        pred[Path(r['file']).stem.lower()] = ('2' if p2 >= p3 else '3', round(max(p2, p3) / max(p2 + p3, 1e-9), 3))

crop_index = {p.stem.lower(): p for p in CROPS.rglob('*.jpg')}
full_index = {p.stem.lower(): p for s in ('train', 'val') for c in CLASSES.values() for p in (FULL512 / s / c).glob('*')}

if OUT.exists():
    shutil.rmtree(OUT)
(OUT / 'images' / 'crop').mkdir(parents=True)
(OUT / 'images' / 'full').mkdir(parents=True)

items = []
for r in rows:
    name = Path(r['path'])
    stem = name.stem.lower()
    t = name.name.split('_')
    date, risk, worker = (t[9], t[7], t[8]) if len(t) > 9 else ('', '', r['worker'])
    full = full_index.get(stem)
    if full is None:
        continue
    iid = name.stem
    with Image.open(full) as im:  # 전체 사진은 긴 변 768로 줄여 키트 용량을 낮춘다
        im = im.convert('RGB'); sc = min(1.0, 768 / max(im.size))
        if sc < 1.0:
            im = im.resize((round(im.size[0] * sc), round(im.size[1] * sc)), Image.LANCZOS)
        im.save(OUT / 'images' / 'full' / f'{iid}.jpg', quality=88)
    crop = crop_index.get(stem)
    shutil.copyfile(crop if crop else full, OUT / 'images' / 'crop' / f'{iid}.jpg')
    p = pred.get(stem)
    items.append(dict(id=iid, label=r['class_id'], label_kor=KOR[r['class_id']], worker=worker, date=date, risk=risk,
                      split=r['split'], has_box=bool(crop), model_pred=(KOR[p[0]] if p else ''), model_conf=(p[1] if p else ''),
                      disputed=bool(p and p[0] != r['class_id'])))

# 검토 순서: 모델이 틀린 시험셋 사진 → 나머지 시험셋 → 학습·검증. 같은 묶음 안에서는 라벨, 촬영일 순.
items.sort(key=lambda d: (0 if d['disputed'] else 1 if d['split'] == 'test' else 2, d['label'], d['date'], d['id']))
for i, d in enumerate(items, 1):
    d['seq'] = i

with (OUT / 'review_sheet.csv').open('w', newline='', encoding='utf-8-sig') as f:
    w = csv.writer(f)
    w.writerow(['seq', 'id', 'aihub_label', 'worker', 'date', 'risk', 'split', 'has_box', 'model_pred_448', 'model_conf', 'disputed',
                'reviewer_label', 'reviewer_note'])
    for d in items:
        w.writerow([d['seq'], d['id'], d['label_kor'], d['worker'], d['date'], d['risk'], d['split'], int(d['has_box']),
                    d['model_pred'], d['model_conf'], int(d['disputed']), '', ''])

page = """<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>무 질병 라벨 재검토</title>
<style>
body{font-family:system-ui,'Malgun Gothic',sans-serif;margin:0;background:#f4f4f4;color:#222}
header{display:flex;gap:16px;align-items:center;padding:10px 16px;background:#fff;border-bottom:1px solid #ddd;flex-wrap:wrap}
main{display:grid;grid-template-columns:3fr 2fr;gap:12px;padding:12px 16px}
.pane{background:#fff;border:1px solid #ddd;padding:8px}
.pane img{width:100%;height:auto;display:block}
.meta{font-size:14px;line-height:1.7}
.btns{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
button{padding:10px 14px;font-size:15px;border:1px solid #999;border-radius:6px;background:#fafafa;cursor:pointer}
button.sel{background:#2563eb;color:#fff;border-color:#2563eb}
textarea{width:100%;box-sizing:border-box;height:60px}
.small{color:#666;font-size:13px}
kbd{background:#eee;border:1px solid #ccc;border-radius:3px;padding:0 4px;font-size:12px}
</style></head><body>
<header>
 <b>무 질병 라벨 재검토</b>
 <span id="prog"></span>
 <button onclick="go(-1)">◀ 이전 <kbd>←</kbd></button>
 <button onclick="go(1)">다음 ▶ <kbd>→</kbd></button>
 <button onclick="jumpNext()">미판정으로 이동</button>
 <input id="jump" type="number" min="1" style="width:70px" placeholder="번호"><button onclick="jumpTo()">이동</button>
 <button onclick="exportCsv()">CSV 내보내기</button>
 <span class="small">판정은 이 브라우저에 자동 저장됩니다. 끝나면 CSV 내보내기를 눌러 파일을 보내 주세요.</span>
</header>
<main>
 <div class="pane"><div class="small">병반 근접 (원본 해상도에서 잘라 냄)</div><img id="crop"></div>
 <div>
  <div class="pane"><div class="small">전체 사진</div><img id="full"></div>
  <div class="pane meta" id="meta"></div>
  <div class="pane">
   <div class="btns" id="btns"></div>
   <textarea id="note" placeholder="메모 (예: 뒷면 안 보임, 두 병 섞임, 잎이 아님)"></textarea>
   <div class="small">단축키: <kbd>1</kbd> 검은무늬병 <kbd>2</kbd> 노균병 <kbd>3</kbd> 혼합 <kbd>4</kbd> 판정불가 <kbd>5</kbd> 질병 아님 · 판정하면 자동으로 다음 사진으로 넘어갑니다.</div>
  </div>
 </div>
</main>
<script>
const ITEMS = __ITEMS__;
const LABELS = ['검은무늬병','노균병','혼합(두 병 모두)','판정불가','질병 아님/다른 문제'];
const KEY = 'radish_relabel_v1';
let state = JSON.parse(localStorage.getItem(KEY) || '{}');
let i = Math.max(0, ITEMS.findIndex(d => !state[d.id]));
if (i < 0) i = 0;
function save(){ localStorage.setItem(KEY, JSON.stringify(state)); }
function render(){
  const d = ITEMS[i];
  document.getElementById('crop').src = 'images/crop/' + d.id + '.jpg';
  document.getElementById('full').src = 'images/full/' + d.id + '.jpg';
  const done = Object.keys(state).filter(k => state[k].label).length;
  document.getElementById('prog').textContent = `${i+1} / ${ITEMS.length}  (판정 ${done}장)`;
  document.getElementById('meta').innerHTML =
    `<b>AI Hub 라벨: ${d.label_kor}</b><br>촬영일 ${d.date.slice(0,4)}-${d.date.slice(4,6)}-${d.date.slice(6,8)} · 피해 정도 ${d.risk} · 작업자 ${d.worker}` +
    (d.has_box ? '' : '<br><span class="small">병반 박스가 없어 전체 사진을 보여 줍니다</span>') +
    `<br><span class="small">${d.id}</span>`;
  const s = state[d.id] || {};
  document.getElementById('btns').innerHTML = LABELS.map((l, k) =>
    `<button class="${s.label === l ? 'sel' : ''}" onclick="pick(${k})">${k+1}. ${l}</button>`).join('');
  document.getElementById('note').value = s.note || '';
  document.getElementById('jump').value = i + 1;
}
function pick(k){
  const d = ITEMS[i];
  state[d.id] = Object.assign(state[d.id] || {}, {label: LABELS[k], note: document.getElementById('note').value});
  save(); if (i < ITEMS.length - 1) { i++; } render();
}
function go(n){ saveNote(); i = Math.min(ITEMS.length - 1, Math.max(0, i + n)); render(); }
function jumpNext(){ saveNote(); const j = ITEMS.findIndex((d, k) => k > i && !(state[d.id] && state[d.id].label)); if (j >= 0) { i = j; render(); } }
function jumpTo(){ saveNote(); const v = parseInt(document.getElementById('jump').value, 10); if (v >= 1 && v <= ITEMS.length) { i = v - 1; render(); } }
function saveNote(){ const d = ITEMS[i]; const v = document.getElementById('note').value; if (v || state[d.id]) { state[d.id] = Object.assign(state[d.id] || {}, {note: v}); save(); } }
function exportCsv(){
  saveNote();
  const rows = [['seq','id','aihub_label','worker','date','risk','split','reviewer_label','reviewer_note']];
  for (const d of ITEMS) { const s = state[d.id] || {}; rows.push([d.seq, d.id, d.label_kor, d.worker, d.date, d.risk, d.split, s.label || '', (s.note || '').replace(/\\r?\\n/g, ' ')]); }
  const csv = '\\ufeff' + rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], {type: 'text/csv'})); a.download = 'radish_relabel_result.csv'; a.click();
}
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
  if (e.key >= '1' && e.key <= '5') pick(parseInt(e.key) - 1);
  else if (e.key === 'ArrowLeft') go(-1); else if (e.key === 'ArrowRight') go(1);
});
document.getElementById('note').addEventListener('change', saveNote);
render();
</script></body></html>
"""
slim = [{k: d[k] for k in ('seq', 'id', 'label_kor', 'worker', 'date', 'risk', 'split', 'has_box')} for d in items]
(OUT / 'review.html').write_text(page.replace('__ITEMS__', json.dumps(slim, ensure_ascii=False)), encoding='utf-8')
(OUT / 'README.txt').write_text(
    '무 질병(검은무늬병·노균병) AI Hub 라벨 재검토 키트\n\n'
    '1. review.html을 브라우저(크롬/엣지)로 엽니다. 인터넷 연결은 필요 없습니다.\n'
    '2. 왼쪽은 병반을 원본 해상도로 잘라 낸 사진, 오른쪽은 전체 사진입니다.\n'
    '3. 사진마다 1~5 버튼(또는 숫자 키)으로 판정합니다. 판정하면 다음 사진으로 넘어갑니다.\n'
    '   1 검은무늬병 / 2 노균병 / 3 혼합(두 병 모두) / 4 판정불가(사진만으로 알 수 없음) / 5 질병 아님·다른 문제\n'
    '4. AI Hub 라벨과 판정이 달라도 그대로 눌러 주세요. 라벨이 맞는지 보는 것이 목적입니다.\n'
    '5. 판정은 브라우저에 자동 저장됩니다. 끝나면 "CSV 내보내기"를 눌러 radish_relabel_result.csv를 보내 주세요.\n'
    f'   사진은 {len(items)}장이며, 앞쪽 {sum(d["disputed"] for d in items)}장은 모델과 라벨이 엇갈린 사진이라 먼저 배치했습니다.\n',
    encoding='utf-8')
summary = dict(images=len(items), with_box=sum(d['has_box'] for d in items), disputed_first=sum(d['disputed'] for d in items),
               by_label={KOR[k]: sum(d['label'] == k for d in items) for k in CLASSES}, by_split={s: sum(d['split'] == s for d in items) for s in ('train', 'val', 'test')})
(OUT / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding='utf-8')
print(json.dumps(summary, ensure_ascii=False))
zip_out = HERE / 'radish_relabel_kit.zip'
if zip_out.exists():
    zip_out.unlink()
shutil.make_archive(str(zip_out.with_suffix('')), 'zip', root_dir=HERE, base_dir='radish_relabel_kit')
print('zip', round(zip_out.stat().st_size / 1e6, 1), 'MB')
