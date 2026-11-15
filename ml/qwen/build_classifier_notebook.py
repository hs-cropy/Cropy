"""Write the Colab notebook that trains a small encoder CLASSIFIER for function selection on the same data as Qwen.

Why: Qwen 2B (1.34 GB) cannot be loaded in iPhone Safari and 0.8B (576 MB) sits on the tab-memory limit
(ml/qwen README, 2026-11-10). The task itself is closed: one of 9 functions plus small integer arguments, so a
14M-parameter encoder with one classification head per argument can do it in ~15-30 MB (int8 ONNX) on any phone.

Same inputs (utterance + compact context JSON), same splits, same labels and the same metrics (function / exact) as
the Qwen runs, so the numbers are directly comparable with cropy_qwen_v2/<run>/eval_metrics.json.

Output
  cropy_fs_classifier_colab.ipynb   upload to Drive MyDrive/cropy_qwen_v2/ next to qwen_v2c_data.jsonl.xz and run
Results land in Drive cropy_qwen_v2/<RUN_NAME>/: eval_metrics.json, eval_cases.jsonl, model.onnx, model_int8.onnx,
tokenizer files, labels.json.
"""
import hashlib
import json
from pathlib import Path

import spec_v2

HERE = Path(__file__).resolve().parent
DATA_FILE = "qwen_v2c_data.jsonl.xz"
DATA_SHA = hashlib.sha256((HERE / "data_v2" / DATA_FILE).read_bytes()).hexdigest()
import sys
SEED = int(sys.argv[1]) if len(sys.argv) > 1 else 20261110
NOTEBOOK = f"cropy_fs_classifier_colab_s{SEED}.ipynb" if len(sys.argv) > 1 else "cropy_fs_classifier_colab.ipynb"
# (function, argument) -> ordered value names; the head layout. Function order = <hs_N> order.
HEADS = [(name, arg, [v for v, _ in values]) for name, args, _ in spec_v2.FUNCTIONS for arg, values in args.items()]
LABELS = {"functions": spec_v2.NAMES, "heads": [{"function": f, "argument": a, "values": v} for f, a, v in HEADS]}

# 실제 앱이 화면 상태에 넣는 농약 이름 (백엔드 시드). 화면 상태 채우기 증강에 쓴다
SEED_DIR = HERE.parents[1] / "backend" / "app" / "data" / "seed"
_diseases = {d["key"]: d["name"] for d in json.loads((SEED_DIR / "diseases.json").read_text(encoding="utf-8"))}
_products = {x["key"]: x["name"] for x in json.loads((SEED_DIR / "pesticides.json").read_text(encoding="utf-8"))}
REAL_PESTICIDES = {}
for link in sorted(json.loads((SEED_DIR / "disease_pesticides.json").read_text(encoding="utf-8")), key=lambda x: x["priority"]):
    if link["pesticide_key"] in _products:
        REAL_PESTICIDES.setdefault(_diseases[link["disease_key"]], []).append(_products[link["pesticide_key"]])
DISEASE_NAMES = [n for n in _diseases.values() if n != "판별 불가"]


ENRICH_CELL = '\ndef norm_name(name):\n    return re.sub(r\'^(고추|배추|무)\\s*\', lambda m: m.group(1) + \' \', name.strip())\n\ndef crop_of(name):\n    for c in (\'고추\', \'배추\', \'무\'):\n        if name.startswith(c):\n            return c\n    return None\n\ndef enrich_context(r, rng, p_key=0.8):\n    ctx = r[\'context\']\n    name = ctx.get(\'disease_name\')\n    if r[\'function\'] in ENRICH_SKIP or ctx.get(\'ui_stage\') != \'result\' or not name:\n        return None\n    if ctx.get(\'crop_mismatch\') or ctx.get(\'category\') not in (None, \'disease\', \'normal\') or ctx.get(\'prediction_mode\') == \'mock\':\n        return None\n    crop = crop_of(name)\n    if crop is None:\n        return None\n    healthy = name.endswith(\'정상\')\n    conf = ctx.get(\'confidence\', round(rng.uniform(0.55, 0.99), 2))\n    others = [d for d in DISEASE_NAMES if d.startswith(crop) and d != norm_name(name)]\n    second = {\'name\': rng.choice(others), \'confidence\': round(rng.uniform(0.01, max(0.02, 1 - conf)), 2)} if others else None\n    fill = {\'selected_crop\': crop, \'predicted_crop\': crop, \'crop_mismatch\': False, \'prediction_mode\': \'model\',\n            \'category\': \'normal\' if healthy else \'disease\', \'confidence\': conf,\n            \'top_predictions\': [{\'name\': name, \'confidence\': conf}] + ([second] if second else []),\n            \'severity\': \'low\' if healthy else rng.choice([\'low\', \'medium\', \'high\']),\n            \'decision_status\': \'disease\', \'save_status\': \'saved\'}\n    if healthy:\n        fill.pop(\'decision_status\')\n    products = REAL_PESTICIDES.get(norm_name(name))\n    if products and not healthy and r[\'function\'] not in NO_PESTICIDE_ADD:\n        fill[\'pesticides\'] = products[:rng.randint(1, 5)]\n    n = dict(ctx)\n    added = 0\n    for k, v in fill.items():\n        if k not in n and (k == \'crop_mismatch\' or rng.random() < p_key):\n            n[k] = v\n            added += 1\n    if not added:\n        return None\n    return {k: n[k] for k in CONTEXT_KEYS if k in n}\n\ndef enrich_rows(rows_, seed, tag):\n    rng = random.Random(seed)\n    out = []\n    for r in rows_:\n        ctx = enrich_context(r, rng)\n        if ctx is None:\n            continue\n        n = copy.deepcopy(r)\n        n[\'context\'] = ctx\n        n[\'augmentation\'] = f"{r.get(\'augmentation\')}+{tag}"\n        n[\'case_id\'] = f"{r[\'case_id\']}~{tag}"\n        out.append(n)\n    return out\n\nif ENRICH:\n    extra = enrich_rows(train_rows, SEED, \'enrich\')\n    print(f\'context enrich: +{len(extra)} rows -> {len(train_rows) + len(extra)} train\')\n    print(Counter(r[\'function\'] for r in extra))\n    for r in extra[:2]:\n        print(\' \', r[\'user_text\'], \'|\', json.dumps(r[\'context\'], ensure_ascii=False)[:160])\n    train_rows = train_rows + extra\n# validation 을 같은 규칙으로 채운 판 (원래 validation 과 별도로 잰다)\nval_enriched_rows = enrich_rows(val_rows, SEED + 1, \'enrich_val\')\nprint(\'validation_enriched\', len(val_enriched_rows))\n'


PROBE_CELL = "\nFULL = {'ui_stage': 'result', 'selected_crop': '고추', 'predicted_crop': '고추', 'crop_mismatch': False, 'prediction_mode': 'model',\n        'category': 'disease', 'disease_name': '고추 탄저병', 'confidence': 0.92,\n        'top_predictions': [{'name': '고추 탄저병', 'confidence': 0.92}, {'name': '고추 흰가루병', 'confidence': 0.03}],\n        'severity': 'high', 'decision_status': 'disease', 'save_status': 'saved', 'pesticides': REAL_PESTICIDES['고추 탄저병'][:5]}\nSHORT = {'ui_stage': 'result', 'prediction_mode': 'model', 'category': 'disease', 'disease_name': '고추 탄저병', 'confidence': 0.92}\nPROBES = [('이거 무슨 병이야', 0), ('병 이름이 뭐야', 0), ('어떻게 관리해야 돼', 3), ('관리해야 돼', 3),\n          ('등록된 농약 목록 알려 줘', 4), ('등록된 농약 알려줘', 4), ('농약 뭐 써야 돼', 4), ('무슨 약 뿌려야 돼', 4), ('탄저병 약 추천해 줘', 4)]\nprobe_rows = [{'case_id': f'probe{i}_{name}', 'function': FUNCTIONS[fn], 'user_text': u, 'context': ctx}\n              for i, (u, fn) in enumerate(PROBES) for name, ctx in (('full', FULL), ('short', SHORT))]\nprobe_enc = []\nfor r in probe_rows:\n    a, b = text_pair(r)\n    e = tokenizer(a, b, truncation='only_second', max_length=MAX_LEN)\n    probe_enc.append({k: e[k] for k in e.keys()} | {'fn': FUNCTIONS.index(r['function']), 'heads': [-100] * len(HEADS)})\nprobe_ok, probe_log = 0, []\nfor r, p in zip(probe_rows, predict(model, probe_enc)):\n    ok = FUNCTIONS[p['fn']] == r['function']; probe_ok += ok\n    probe_log.append({'case': r['case_id'], 'utterance': r['user_text'], 'expected': r['function'], 'actual': FUNCTIONS[p['fn']], 'fn_conf': round(p['fn_conf'], 3)})\n    print('O' if ok else 'X', r['case_id'].split('_')[-1], r['user_text'], '->', FUNCTIONS[p['fn']], round(p['fn_conf'], 2))\nprint(f'probe function {probe_ok}/{len(probe_rows)}')\n(OUTPUT_DIR / 'probe.json').write_text(json.dumps({'correct': probe_ok, 'total': len(probe_rows), 'rows': probe_log}, ensure_ascii=False, indent=1))\n"


DISTILL_CELL = "\nDISTILL_ROWS = []\nif USE_DISTILL:\n    DISTILL_ROWS = [json.loads(l) for l in (Path(DISTILL_DIR) / 'paraphrases.jsonl').read_text(encoding='utf-8').splitlines()]\n    for r in DISTILL_ROWS:\n        r['output'] = merge_output(r['function'], r['output'])\n    # 말 바꾼 문장도 작물↔인자 지름길을 물려받으므로 다른 작물 하나로 바꾼 사본을 더한다 (원래 행은 두 작물)\n    rng = random.Random(SEED + 7)\n    swapped = []\n    for r in DISTILL_ROWS:\n        text = r['user_text'] + json.dumps(r['context'], ensure_ascii=False)\n        present = [c for c in CROPS if (re.search(r'(?<![가-힣])무(?![가-힣])', text) if c == '무' else c in text)]\n        if len(present) == 1:\n            swapped.append(swap_row(r, present[0], rng.choice([c for c in CROPS if c != present[0]])))\n    print(f'distill: +{len(DISTILL_ROWS)} paraphrases, +{len(swapped)} crop-swapped')\n    print(Counter(r['function'] for r in DISTILL_ROWS))\n    train_rows = train_rows + DISTILL_ROWS + swapped\n"


def md(text):
    return {"cell_type": "markdown", "metadata": {}, "source": text.strip("\n").splitlines(keepends=True)}


def code(text):
    return {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [],
            "source": text.strip("\n").splitlines(keepends=True)}


cells = [
    md(f"""
# Cropy 기능 선택 **분류기** 학습 (Qwen 대체 후보, 휴대폰용)

Qwen 2B는 아이폰 Safari에 올라가지 않고 0.8B는 탭 메모리 한도 경계에 있어(2026-11-10 측정), 같은 데이터로
작은 인코더 분류기를 학습해 비교한다. 입력(발화 + 화면 상태 JSON)·분할·라벨·지표가 Qwen 학습과 같아서
`cropy_qwen_v2/<run>/eval_metrics.json`과 바로 비교된다.

- 모델: `{{ENCODER}}` 인코더 + 헤드 {1 + len(HEADS)}개 (기능 1개 + 기능별 인자 {len(HEADS)}개). 각 행은 기능 헤드와 **그 기능의 인자 헤드**에만 손실을 준다.
- 데이터: Drive `cropy_qwen_v2/{DATA_FILE}` (train 5,062 / validation 1,160, sha256 확인)
- 결과: Drive `cropy_qwen_v2/<RUN_NAME>/` — eval_metrics.json, eval_cases.jsonl, model.onnx, model_int8.onnx, 토크나이저
- 런타임: **T4면 충분**(14M 파라미터, 30 epoch 약 8분; 1차 10 epoch는 L4에서 161초). seed를 바꿔 3번 돌려 흔들림을 본다(Qwen은 ±2%p).
- 1차 결과(e10, lr 5e-5, [CLS]): function 74.0 / exact 54.0 — 손실이 아직 내려가는 중이라 과소적합. 이 판은 lr 1.5e-4, 30 epoch, 평균 풀링.

1. 런타임 → GPU 선택 → 모두 실행.
2. 끝나면 `eval_metrics.json`의 function/exact를 Qwen 2B 평균 모델(97.5 / 97.0)·0.8B 평균(97.2 / 92.2)과 비교한다.
"""),
    code(f"""
from google.colab import drive
drive.mount('/content/drive')

import hashlib, json, lzma, os, random, time
from pathlib import Path

DRIVE_DIR = Path('/content/drive/MyDrive/cropy_qwen_v2')
DATA_FILE = DRIVE_DIR / '{DATA_FILE}'
DATA_SHA = '{DATA_SHA}'

ENCODER = 'monologg/koelectra-small-v3-discriminator'   # 14M. 5차 base(110M)는 88.7/82.2로 small보다 낮고 int8 손실 4p — 확대 경로 종료
SEED = {SEED}            # 흔들림을 보려면 seed만 바꿔 다시 돌린다
# 1차(e10, lr 5e-5, [CLS] 풀링): function 74.0 / exact 54.0 — 10 epoch에도 손실 3.2로 계속 내려가는 중(과소적합).
# 작은 모델은 학습률을 올리고 오래 돌린다. 풀링은 평균으로.
# 2차(e30, lr 1.5e-4, 평균 풀링): train 100% / validation 54.6%, best epoch 13 — 과소적합이 아니라 작물↔인자 지름길(아래 셀).
# 4차(small, e20, lr 1.5e-4, swap+ctx): function 91.6 / exact 86.6, best epoch 10 — 문맥 지름길 해소. 남은 약점은 기능 선택(예측 지표 80.3, 명확화 84.3).
# 5차(base, e12, lr 5e-5): 88.7 / 82.2 — 용량이 아니라 데이터 한계. 6차: v4 설정 그대로 seed만 바꿔 분산 확인.
# 9차(_enrich): 실제 앱처럼 화면 상태를 채운 사본 추가. v8은 키가 다 찬 결과 화면에서 '등록된 농약 목록 알려 줘'를 진단으로 골랐다(11/16).
# 10차: Qwen 선생님이 확인한 말 바꾸기 문장(cropy_fs_distill_data_colab.ipynb)을 더하고, 농약 이름 목록을 개수로 바꿔 넣는다.
DISTILL_DIR = DRIVE_DIR / 'distill_v2'   # 없으면 '' 로. paraphrases.jsonl 이 있으면 쓴다
USE_DISTILL = bool(DISTILL_DIR) and (Path(DISTILL_DIR) / 'paraphrases.jsonl').exists()
CONTEXT_FORMAT = 'clf_v2'               # 분류기 입력: 키를 짧은 한국어로, pesticides 는 이름 목록 대신 개수로. '' 이면 9차까지와 같다
EPOCHS = 8 if USE_DISTILL else 20       # 문장이 몇 배 늘어 epoch 를 줄인다 (A100 권장)
LR = 1.5e-4
POOLING = 'mean'           # 'cls' = 첫 토큰
MERGE_TAG = '_merge'       # 7차: 겹치는 topic 접기(아래 TOPIC_MERGE). 끄려면 '' 로 두고 TOPIC_MERGE = {{}}
BATCH = 32
MAX_LEN = 256              # 발화 + 압축 context JSON. 넘치는 행은 아래에서 센다
RUN_NAME = f"clf_{{ENCODER.split('/')[-1].replace('-discriminator','')}}_{{POOLING}}_lr{{LR:g}}_e{{EPOCHS}}_swap_ctx{{MERGE_TAG}}_enrich{{'_distill' if USE_DISTILL else ''}}{{'_' + CONTEXT_FORMAT if CONTEXT_FORMAT else ''}}_s{{SEED}}"
OUTPUT_DIR = DRIVE_DIR / RUN_NAME
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
print(RUN_NAME)
"""),
    code("""
%pip -q install onnx onnxruntime
import torch, transformers
print(torch.__version__, transformers.__version__, torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU')
"""),
    md("## 데이터와 라벨"),
    code(f"""
raw = DATA_FILE.read_bytes()
assert hashlib.sha256(raw).hexdigest() == DATA_SHA, '데이터 파일이 노트북을 만든 것과 다릅니다'
rows = [json.loads(l) for l in lzma.decompress(raw).decode('utf-8').splitlines()]
train_rows = [r for r in rows if r['split'] == 'train']
val_rows = [r for r in rows if r['split'] == 'validation']
print(len(train_rows), 'train', len(val_rows), 'validation')

# 7차: 분류기 쪽에서만 뜻이 겹치는 topic을 접는다(데이터·Qwen·핸들러는 그대로). 값은 기존 topic 번호 중 하나로 보내므로
# 출력 형식과 핸들러 템플릿은 변하지 않는다. v4 오답 분석: comparison→ranking 11, limits→confidence 7, 재촬영 provenance↔certainty,
# 농약 checklist→verification. 세 시드 평균 exact 84.0; v4 결과를 이 표로 다시 채점하면 86.6→88.3.
TOPIC_MERGE = {{   # (function, argument): {{접을 값: 남길 값}}  (1-based, Qwen 출력 번호)
    ('get_prediction_metrics', 'topic'): {{5: 2, 4: 1}},   # comparison→ranking, limits→confidence
    ('get_recapture_guidance', 'topic'): {{4: 3}},         # provenance→certainty
    ('get_pesticide_information', 'topic'): {{9: 6}},      # checklist→verification
}}

def merge_output(fn_name, output):
    def fix(m):
        k, v = m.group(1), int(m.group(2))
        return f"{{k}}={{TOPIC_MERGE.get((fn_name, k), {{}}).get(v, v)}}"
    return re.sub(r'([a-z_]+)=(-?\d+)', fix, output)

import re
n_changed = 0
for r in rows:
    new = merge_output(r['function'], r['output'])
    n_changed += new != r['output']
    r['output'] = new
print('topic merge:', n_changed, 'rows relabelled')

LABELS = {json.dumps(LABELS, ensure_ascii=False)}
FUNCTIONS = LABELS['functions']
HEADS = LABELS['heads']                       # 기능별 인자 헤드. 값 번호 = 인자 설명의 번호 (Qwen 출력과 같음)
HEAD_INDEX = {{(h['function'], h['argument']): i for i, h in enumerate(HEADS)}}
if CONTEXT_FORMAT:
    LABELS['context_format'] = CONTEXT_FORMAT   # 서버(selector/server.py)·휴대폰(mobileClfSelector.ts)이 같은 규칙을 적용한다
(OUTPUT_DIR / 'labels.json').write_text(json.dumps(LABELS, ensure_ascii=False, indent=1))

import re
CALL = re.compile(r'^<hs_(\\d+)>\\(((?:[a-z_]+=-?\\d+(?:, [a-z_]+=-?\\d+)*)?)\\)<hs_end>$')

def parse(output):
    m = CALL.match(output.strip())
    fn = int(m.group(1))
    args = dict(p.split('=') for p in m.group(2).split(', ')) if m.group(2) else {{}}
    return fn, {{k: int(v) - 1 for k, v in args.items()}}     # 0-based 값 번호

def targets(r):
    fn, args = parse(r['output'])
    assert FUNCTIONS[fn] == r['function']
    t = [-100] * len(HEADS)                                    # -100 = 이 행에는 없는 헤드(손실 제외)
    for arg, v in args.items():
        t[HEAD_INDEX[(r['function'], arg)]] = v
    return fn, t

# 'clf_v2': 9차는 결과 화면을 다 채우면 화면 상태만 230토큰이라 train 4,118행이 256토큰에서 잘렸다.
#  - 영어 키는 한국어 WordPiece 에서 잘게 쪼개지므로 짧은 한국어 키로 바꾼다 (230 → 172토큰)
#  - 농약은 이름 목록 대신 개수. 기능·인자는 목록이 있는지·몇 개인지로 정해진다(제품 지칭은 발화의 '목록의 A'·'B')
# 서버(selector/server.py)와 휴대폰(mobileClfSelector.ts)이 labels.json 의 context_format 을 보고 같은 규칙을 적용한다
CLF_KEYS = {{'ui_stage': '단계', 'selected_crop': '선택작물', 'predicted_crop': '예측작물', 'crop_mismatch': '작물불일치',
            'prediction_mode': '방식', 'category': '분류', 'disease_name': '병명', 'confidence': '점수', 'top_predictions': '후보',
            'severity': '심각도', 'decision_status': '판정', 'save_status': '저장', 'recapture': '재촬영', 'pesticides': '농약',
            'selected_usage_id': '선택제품', 'pending_target': '되물음', 'name': '이름', 'region': '부위'}}

def _rename(v):
    if isinstance(v, dict):
        return {{CLF_KEYS.get(k, k): _rename(x) for k, x in v.items()}}
    if isinstance(v, list):
        return [_rename(x) for x in v]
    return v

def clf_context(ctx):
    if CONTEXT_FORMAT != 'clf_v2':
        return ctx
    ctx = dict(ctx)
    if isinstance(ctx.get('pesticides'), list):
        ctx['pesticides'] = len(ctx['pesticides'])
    return _rename(ctx)

def text_pair(r):
    # Qwen 프롬프트의 user 메시지와 같은 내용: 발화, 압축된 context JSON (분류기 형식)
    return r['user_text'], json.dumps(clf_context(r['context']), ensure_ascii=False, separators=(',', ':'))

from collections import Counter
print(Counter(r['function'] for r in train_rows))
"""),
    md("""
## 작물 바꿔치기 증강 (2차 결과의 원인)

2차(lr 1.5e-4, 30 epoch)는 train exact 100%인데 validation 54.6%였다. 데이터를 보면 train에서 인자가 작물과 거의 1:1로 묶여
있다(재촬영 topic 1·3 = 무, 2·4 = 배추 / 관리 topic 1 = 고추, 2 = 무, 3 = 배추 / 범위 밖 reason 1 = 고추, 2 = 무, 3 = 배추).
validation은 그 조합이 **반대**라서(재촬영 topic 1·3 = 배추, 2·4 = 무), 작물을 보고 인자를 고른 모델은 우연보다 못 맞힌다
(재촬영 exact 3%). Qwen은 언어 지식으로 이 지름길을 피하지만 14M 인코더는 가장 쉬운 단서를 외운다.
그래서 train 각 행에 대해 발화·context의 작물(고추·무·배추)을 다른 두 작물로 바꾼 사본을 더해 작물이 라벨 정보를 갖지 않게 한다.
validation은 그대로.
"""),
    code("""
import copy
CROPS = ['고추', '무', '배추']
CROP_SWAP = True

def swap_text(s, a, b):
    # 두 글자 작물명은 그대로 바꾸고, 한 글자 '무'는 앞뒤가 한글이 아닐 때만(무름병·무엇·무가 제외)
    if a == '무':
        return re.sub(r'(?<![가-힣])무(?![가-힣])', b, s)
    return s.replace(a, b)

def swap_row(r, a, b):
    n = copy.deepcopy(r)
    n['user_text'] = swap_text(r['user_text'], a, b)
    ctx = json.loads(swap_text(json.dumps(r['context'], ensure_ascii=False), a, b))
    n['context'] = ctx
    n['augmentation'] = f"{r.get('augmentation')}+swap_{a}_{b}"
    n['case_id'] = f"{r['case_id']}~{a}>{b}"
    return n

if CROP_SWAP:
    extra = []
    for r in train_rows:
        text = r['user_text'] + json.dumps(r['context'], ensure_ascii=False)
        present = [c for c in CROPS if (re.search(r'(?<![가-힣])무(?![가-힣])', text) if c == '무' else c in text)]
        if len(present) != 1:       # 작물이 없거나 둘 이상(작물 불일치 등)이면 그대로 둔다
            continue
        a = present[0]
        extra += [swap_row(r, a, b) for b in CROPS if b != a]
    print(f'crop swap: +{len(extra)} rows -> {len(train_rows) + len(extra)} train')
    for r in extra[:3]:
        print(' ', r['user_text'], '|', json.dumps(r['context'], ensure_ascii=False)[:90])
    train_rows = train_rows + extra
"""),
    md("""
## 화면 상태 섞기 증강 (3차 결과의 원인)

3차(작물 바꿔치기)는 기능 88.9 / exact 61.6, 재촬영 인자는 여전히 5%. 데이터를 다시 보면 지름길은 작물만이 아니라
**화면 상태 전체**다. 재촬영 행의 context는 train에 16가지뿐이고(부위·점수·병명 조합), 그 조합이 validation에서는
다른 topic과 묶여 있다 — train context→topic 다수결을 validation에 적용하면 0/128, 작물·병명을 빼고도 5/128이다.
즉 작물·병명만 자리표시자로 바꿔도(비어휘화) 재촬영은 안 고쳐진다.

인자가 발화로 결정되는 기능(진단·점수·재촬영·관리·농약 topic·범위 밖 reason)은 train 행마다 **같은 기능의 다른 라벨 행에서
가져온 context**를 붙인 사본을 더해 context→인자 상관을 없앤다. 사용법(topic=capture는 사진 전 단계)·되묻기(target=product는
제품 여러 개)처럼 인자가 화면 상태에 정당하게 의존하는 기능은 섞지 않는다. validation은 그대로.
""" ),
    code("""
CONTEXT_SHUFFLE = True
SHUFFLE_FUNCTIONS = {'get_diagnosis', 'get_prediction_metrics', 'get_recapture_guidance', 'get_care_information',
                     'get_pesticide_information', 'handle_scope_limit'}
if CONTEXT_SHUFFLE:
    rng = random.Random(SEED)
    by_fn = {}
    for r in train_rows:
        by_fn.setdefault(r['function'], []).append(r)
    extra = []
    for fn in SHUFFLE_FUNCTIONS:
        pool = by_fn.get(fn, [])
        for r in pool:
            others = [o for o in pool if o['output'] != r['output']]
            if not others:
                continue
            donor = rng.choice(others)
            n = copy.deepcopy(r)
            n['context'] = copy.deepcopy(donor['context'])
            n['augmentation'] = f"{r.get('augmentation')}+ctx_shuffle"
            n['case_id'] = f"{r['case_id']}~ctx"
            extra.append(n)
    print(f'context shuffle: +{len(extra)} rows -> {len(train_rows) + len(extra)} train')
    train_rows = train_rows + extra
"""),
    md("""
## Qwen 선생님이 확인한 말 바꾸기 문장 (10차)

`cropy_fs_distill_data_colab.ipynb`가 train 발화를 말투만 바꿔 늘리고, 배포 중인 Qwen 2B가 원래 라벨과 같은 호출을 낸 문장만 남겼다.
validation 문장과 같은 문장은 버렸다. 파일이 없으면 이 셀은 아무것도 하지 않는다.
"""),
    code(DISTILL_CELL),
    md("""
## 화면 상태 채우기 증강 (9차, 운영 서버 시험의 원인)

v8을 서버에서 실제 앱이 보내는 화면 상태로 시험하니(11/16) "등록된 농약 목록 알려 줘"·"농약 뭐 써야 돼"를 농약이 아닌 진단·재촬영으로 골랐다.
train에서 농약 행은 화면 상태가 짧고(`ui_stage`·병명·농약 이름) 진단·관리 행은 길어서(작물·점수·상위 후보·심각도), **화면 상태의 길이**가
기능의 단서가 되었다. 실제 앱(`compact_context`)은 결과 화면이면 거의 모든 키를 채운다.

결과 화면 행마다 빠진 키를 앱이 보내는 값으로 채운 사본을 하나 더한다: 작물(병명에서), 작물 불일치 false, model, 분류(disease/normal),
점수·상위 후보 2개, 심각도, decision_status·save_status, 그리고 농약 이름(백엔드 시드의 실제 제품명).
- 되묻기는 대상이 화면 상태에 따라 달라 채우지 않는다. 농약 이름은 되묻기·사용법·농약(목록이 없던 행)에는 넣지 않는다.
- 키마다 80% 확률로 채워 길이가 다양하게 한다. validation도 같은 규칙으로 채운 판(`validation_enriched`)을 따로 잰다.
"""),
    code(f"""
ENRICH = True
CONTEXT_KEYS = {json.dumps(list(spec_v2.CONTEXT_KEYS), ensure_ascii=False)}
REAL_PESTICIDES = {json.dumps(REAL_PESTICIDES, ensure_ascii=False)}
DISEASE_NAMES = {json.dumps(DISEASE_NAMES, ensure_ascii=False)}
ENRICH_SKIP = {{'clarify_request'}}
NO_PESTICIDE_ADD = {{'clarify_request', 'get_usage_guidance', 'get_pesticide_information'}}
""" + ENRICH_CELL),
    code("""
from transformers import AutoTokenizer, AutoModel
tokenizer = AutoTokenizer.from_pretrained(ENCODER)

def encode(rows_):
    a, b = zip(*(text_pair(r) for r in rows_))
    enc = tokenizer(list(a), list(b), truncation='only_second', max_length=MAX_LEN, padding=False)
    over = sum(len(tokenizer(x, y)['input_ids']) > MAX_LEN for x, y in zip(a, b))
    print(f'{len(rows_)} rows, {over} truncated at {MAX_LEN} tokens')
    out = []
    for i, r in enumerate(rows_):
        fn, t = targets(r)
        out.append({k: enc[k][i] for k in enc.keys()} | {'fn': fn, 'heads': t})
    return out

train_enc, val_enc = encode(train_rows), encode(val_rows)
val_enr_enc = encode(val_enriched_rows)
"""),
    md("## 모델\n인코더의 첫 토큰([CLS]) 표현에 드롭아웃 → 헤드별 선형층. 손실 = 기능 CE + 그 행의 기능에 속한 인자 헤드 CE."),
    code("""
import torch.nn as nn, torch.nn.functional as F

class Classifier(nn.Module):
    def __init__(self):
        super().__init__()
        self.encoder = AutoModel.from_pretrained(ENCODER)
        h = self.encoder.config.hidden_size
        self.drop = nn.Dropout(0.1)
        self.fn_head = nn.Linear(h, len(FUNCTIONS))
        self.heads = nn.ModuleList([nn.Linear(h, len(hd['values'])) for hd in HEADS])

    def forward(self, input_ids, attention_mask, token_type_ids=None):
        kw = {'token_type_ids': token_type_ids} if token_type_ids is not None else {}
        h = self.encoder(input_ids=input_ids, attention_mask=attention_mask, **kw).last_hidden_state
        if POOLING == 'mean':
            m = attention_mask.unsqueeze(-1).to(h.dtype)
            x = (h * m).sum(1) / m.sum(1).clamp(min=1.0)
        else:
            x = h[:, 0]
        x = self.drop(x)
        return self.fn_head(x), [head(x) for head in self.heads]

def loss_fn(fn_logits, head_logits, fn, heads):
    loss = F.cross_entropy(fn_logits, fn)
    for i, lg in enumerate(head_logits):
        t = heads[:, i]
        if (t != -100).any():
            loss = loss + F.cross_entropy(lg, t, ignore_index=-100)
    return loss

def collate(batch):
    pad = tokenizer.pad([{k: b[k] for k in b if k not in ('fn', 'heads')} for b in batch], return_tensors='pt')
    pad['fn'] = torch.tensor([b['fn'] for b in batch])
    pad['heads'] = torch.tensor([b['heads'] for b in batch])
    return pad

def predict(model, enc_rows, bs=64):
    model.eval(); preds = []
    with torch.no_grad():
        for i in range(0, len(enc_rows), bs):
            b = collate(enc_rows[i:i + bs]); b = {k: v.to(DEVICE) for k, v in b.items()}
            fn_logits, head_logits = model(b['input_ids'], b['attention_mask'], b.get('token_type_ids'))
            fn_prob = fn_logits.softmax(-1)
            fn = fn_prob.argmax(-1)
            for j in range(fn.shape[0]):
                f = int(fn[j]); args = {}
                for hi, hd in enumerate(HEADS):
                    if hd['function'] == FUNCTIONS[f]:
                        args[hd['argument']] = int(head_logits[hi][j].argmax())
                preds.append({'fn': f, 'args': args, 'fn_conf': float(fn_prob[j, f])})
    return preds

def score(enc_rows, rows_, preds):
    out = []
    for e, r, p in zip(enc_rows, rows_, preds):
        fn_ok = p['fn'] == e['fn']
        want = {hd['argument']: e['heads'][hi] for hi, hd in enumerate(HEADS) if e['heads'][hi] != -100}
        exact = fn_ok and p['args'] == want
        call = f"<hs_{p['fn']}>(" + ', '.join(f'{k}={v + 1}' for k, v in p['args'].items()) + ')<hs_end>'
        out.append({'case_id': r['case_id'], 'function': r['function'], 'augmentation': r.get('augmentation'),
                    'user_text': r['user_text'], 'expected': r['output'], 'actual': call,
                    'function_correct': fn_ok, 'exact_correct': exact, 'fn_conf': round(p['fn_conf'], 4)})
    return out

def metrics(cases):
    rate = lambda key, cs: round(sum(c[key] for c in cs) / max(1, len(cs)), 4)
    per_fn = {fn: {'support': len(cs), 'function': rate('function_correct', cs), 'exact': rate('exact_correct', cs)}
              for fn in FUNCTIONS for cs in [[c for c in cases if c['function'] == fn]]}
    return {'support': len(cases), 'format_valid': 1.0, 'function': rate('function_correct', cases),
            'exact': rate('exact_correct', cases), 'per_function': per_fn}
"""),
    md("## 학습\nepoch마다 validation을 재고 exact가 가장 좋은 상태를 남긴다."),
    code("""
from torch.utils.data import DataLoader
from transformers import get_linear_schedule_with_warmup

DEVICE = 'cuda' if torch.cuda.is_available() else 'cpu'
random.seed(SEED); torch.manual_seed(SEED); torch.cuda.manual_seed_all(SEED)
model = Classifier().to(DEVICE)
loader = DataLoader(train_enc, batch_size=BATCH, shuffle=True, collate_fn=collate)
opt = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=0.01)
steps = EPOCHS * len(loader)
sched = get_linear_schedule_with_warmup(opt, int(0.06 * steps), steps)

best, history = None, []
t0 = time.time()
for epoch in range(1, EPOCHS + 1):
    model.train(); total = 0.0
    for b in loader:
        b = {k: v.to(DEVICE) for k, v in b.items()}
        fn_logits, head_logits = model(b['input_ids'], b['attention_mask'], b.get('token_type_ids'))
        loss = loss_fn(fn_logits, head_logits, b['fn'], b['heads'])
        opt.zero_grad(); loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0); opt.step(); sched.step()
        total += float(loss)
    m = metrics(score(val_enc, val_rows, predict(model, val_enc)))
    me = metrics(score(val_enr_enc, val_enriched_rows, predict(model, val_enr_enc)))
    tr = metrics(score(train_enc[:512], train_rows[:512], predict(model, train_enc[:512])))   # 과소적합인지 보려고 train 일부도 잰다
    history.append({'epoch': epoch, 'train_loss': round(total / len(loader), 4), 'train_exact': tr['exact'], 'function': m['function'], 'exact': m['exact'],
                    'enriched_function': me['function'], 'enriched_exact': me['exact']})
    print(f"epoch {epoch:2d} loss {total / len(loader):.4f} train exact {tr['exact']:.4f} | val function {m['function']:.4f} exact {m['exact']:.4f} | enriched {me['function']:.4f} / {me['exact']:.4f} | {time.time() - t0:.0f}s")
    # 원래 validation 과 채운 validation 의 평균으로 고른다 (실제 앱 화면 상태에서도 맞아야 한다)
    if best is None or (m['exact'] + me['exact']) / 2 > best[0]:
        best = ((m['exact'] + me['exact']) / 2, epoch, {k: v.detach().cpu().clone() for k, v in model.state_dict().items()})
model.load_state_dict(best[2])
print('best epoch', best[1], 'mean exact (val, enriched)', best[0])
"""),
    md("## 평가\nQwen 평가와 같은 형식으로 저장한다. `eval_cases.jsonl`의 `fn_conf`는 기능 확률(되묻기 임계값을 정할 때 쓴다)."),
    code("""
cases = score(val_enc, val_rows, predict(model, val_enc))
m = metrics(cases)
m.update({'run': RUN_NAME, 'encoder': ENCODER, 'seed': SEED, 'epochs': EPOCHS, 'best_epoch': best[1], 'lr': LR, 'pooling': POOLING,
          'crop_swap': CROP_SWAP, 'topic_merge': {str(k): v for k, v in TOPIC_MERGE.items()}, 'context_shuffle': CONTEXT_SHUFFLE, 'train_rows': len(train_rows), 'enrich': ENRICH, 'distill': len(DISTILL_ROWS), 'context_format': CONTEXT_FORMAT,
          'batch': BATCH, 'max_len': MAX_LEN, 'params': sum(p.numel() for p in model.parameters()), 'history': history,
          'seconds': round(time.time() - t0), 'env': {'torch': torch.__version__, 'transformers': transformers.__version__,
          'gpu': torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'cpu'}})
(OUTPUT_DIR / 'eval_metrics.json').write_text(json.dumps(m, ensure_ascii=False, indent=2))
(OUTPUT_DIR / 'eval_cases.jsonl').write_text('\\n'.join(json.dumps(c, ensure_ascii=False) for c in cases))
print(json.dumps({k: m[k] for k in ('function', 'exact')}, indent=1))
print(json.dumps(m['per_function'], ensure_ascii=False, indent=1))
enr_cases = score(val_enr_enc, val_enriched_rows, predict(model, val_enr_enc))
me = metrics(enr_cases)
me['run'] = RUN_NAME
(OUTPUT_DIR / 'eval_metrics_enriched.json').write_text(json.dumps(me, ensure_ascii=False, indent=2))
(OUTPUT_DIR / 'eval_cases_enriched.jsonl').write_text('\\n'.join(json.dumps(c, ensure_ascii=False) for c in enr_cases))
print('validation_enriched', json.dumps({k: me[k] for k in ('support', 'function', 'exact')}))
print(json.dumps(me['per_function'], ensure_ascii=False, indent=1))
# 기능 확률이 낮은 행에서 틀림이 몰리는지: 임계값별 (걸러지는 비율, 남은 행의 exact)
for th in (0.5, 0.7, 0.9):
    kept = [c for c in cases if c['fn_conf'] >= th]
    print(f'fn_conf >= {th}: keep {len(kept) / len(cases):.3f}, exact among kept {sum(c["exact_correct"] for c in kept) / max(1, len(kept)):.4f}')
"""),
    md("## 시연 질문 확인\n운영 서버 시험(11/16)에서 틀린 질문을 실제 앱이 보내는 결과 화면 상태(full)와 짧은 상태(short)로 넣는다. 기대: 진단 hs_0, 관리 hs_3, 농약 hs_4."),
    code(PROBE_CELL),
    md("## ONNX로 내보내기 (휴대폰·보드용)\nfp32 ONNX와 int8(동적 양자화) ONNX를 만들고 64행에서 PyTorch와 같은 답인지 확인한다."),
    code("""
import onnx, onnxruntime as ort
from onnxruntime.quantization import quantize_dynamic, QuantType

class Export(nn.Module):
    def __init__(self, m): super().__init__(); self.m = m
    def forward(self, input_ids, attention_mask, token_type_ids):
        fn_logits, head_logits = self.m(input_ids, attention_mask, token_type_ids)
        return (fn_logits, *head_logits)

model.cpu().eval()
sample = collate(val_enc[:2])
inputs = (sample['input_ids'], sample['attention_mask'], sample.get('token_type_ids', torch.zeros_like(sample['input_ids'])))
names = ['fn_logits'] + [f"{h['function']}.{h['argument']}" for h in HEADS]
onnx_path = OUTPUT_DIR / 'model.onnx'
torch.onnx.export(Export(model), inputs, str(onnx_path), opset_version=17, dynamo=False,
                  input_names=['input_ids', 'attention_mask', 'token_type_ids'], output_names=names,
                  dynamic_axes={k: {0: 'batch', 1: 'seq'} for k in ['input_ids', 'attention_mask', 'token_type_ids']} | {n: {0: 'batch'} for n in names})
int8_path = OUTPUT_DIR / 'model_int8.onnx'
quantize_dynamic(str(onnx_path), str(int8_path), weight_type=QuantType.QInt8)
tokenizer.save_pretrained(OUTPUT_DIR)
for p in (onnx_path, int8_path):
    print(p.name, round(p.stat().st_size / 2**20, 1), 'MB')

def onnx_predict(path, enc_rows):
    sess = ort.InferenceSession(str(path), providers=['CPUExecutionProvider'])
    preds = []
    for i in range(0, len(enc_rows), 32):
        b = collate(enc_rows[i:i + 32])
        feed = {'input_ids': b['input_ids'].numpy(), 'attention_mask': b['attention_mask'].numpy(),
                'token_type_ids': b.get('token_type_ids', torch.zeros_like(b['input_ids'])).numpy()}
        outs = dict(zip(names, sess.run(None, feed)))
        for j in range(feed['input_ids'].shape[0]):
            f = int(outs['fn_logits'][j].argmax())
            args = {h['argument']: int(outs[f"{h['function']}.{h['argument']}"][j].argmax()) for h in HEADS if h['function'] == FUNCTIONS[f]}
            preds.append({'fn': f, 'args': args, 'fn_conf': 0.0})
    return preds

torch_preds = predict(model.to(DEVICE), val_enc)
for path in (onnx_path, int8_path):
    p = onnx_predict(path, val_enc)
    same = sum((a['fn'], a['args']) == (b['fn'], b['args']) for a, b in zip(p, torch_preds))
    mm = metrics(score(val_enc, val_rows, p))
    print(f"{path.name}: same answer as PyTorch {same}/{len(p)} | function {mm['function']} exact {mm['exact']}")
    (OUTPUT_DIR / f"eval_metrics_{path.stem}.json").write_text(json.dumps(mm, ensure_ascii=False, indent=2))
"""),
    md("""
## 다음
- seed를 2개 더 바꿔 돌려(`SEED`) exact의 흔들림 폭을 기록한다.
- Qwen README의 비교표에 넣는다: 2B 평균 97.5/97.0, 0.8B 평균 97.2/92.2, 분류기 ?/?.
- STT 받아 적기 문장(`stt_eval/`)으로도 평가해 LLM과 잡음 강건성을 비교한다.
"""),
]

nb = {"cells": cells, "metadata": {"kernelspec": {"display_name": "Python 3", "name": "python3"},
                                   "language_info": {"name": "python"}, "accelerator": "GPU"},
      "nbformat": 4, "nbformat_minor": 5}
(HERE / NOTEBOOK).write_text(json.dumps(nb, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")
print(NOTEBOOK, "heads", len(HEADS), "data sha", DATA_SHA[:12])
