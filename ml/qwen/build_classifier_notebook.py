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
EPOCHS = 20
LR = 1.5e-4
POOLING = 'mean'           # 'cls' = 첫 토큰
MERGE_TAG = '_merge'       # 7차: 겹치는 topic 접기(아래 TOPIC_MERGE). 끄려면 '' 로 두고 TOPIC_MERGE = {{}}
BATCH = 32
MAX_LEN = 256              # 발화 + 압축 context JSON. 넘치는 행은 아래에서 센다
RUN_NAME = f"clf_{{ENCODER.split('/')[-1].replace('-discriminator','')}}_{{POOLING}}_lr{{LR:g}}_e{{EPOCHS}}_swap_ctx{{MERGE_TAG}}_s{{SEED}}"
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

def text_pair(r):
    # Qwen 프롬프트의 user 메시지와 같은 내용: 발화, 압축된 context JSON
    return r['user_text'], json.dumps(r['context'], ensure_ascii=False, separators=(',', ':'))

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
    tr = metrics(score(train_enc[:512], train_rows[:512], predict(model, train_enc[:512])))   # 과소적합인지 보려고 train 일부도 잰다
    history.append({'epoch': epoch, 'train_loss': round(total / len(loader), 4), 'train_exact': tr['exact'], 'function': m['function'], 'exact': m['exact']})
    print(f"epoch {epoch:2d} loss {total / len(loader):.4f} train exact {tr['exact']:.4f} | val function {m['function']:.4f} exact {m['exact']:.4f} | {time.time() - t0:.0f}s")
    if best is None or m['exact'] > best[0]:
        best = (m['exact'], epoch, {k: v.detach().cpu().clone() for k, v in model.state_dict().items()})
model.load_state_dict(best[2])
print('best epoch', best[1], 'exact', best[0])
"""),
    md("## 평가\nQwen 평가와 같은 형식으로 저장한다. `eval_cases.jsonl`의 `fn_conf`는 기능 확률(되묻기 임계값을 정할 때 쓴다)."),
    code("""
cases = score(val_enc, val_rows, predict(model, val_enc))
m = metrics(cases)
m.update({'run': RUN_NAME, 'encoder': ENCODER, 'seed': SEED, 'epochs': EPOCHS, 'best_epoch': best[1], 'lr': LR, 'pooling': POOLING,
          'crop_swap': CROP_SWAP, 'topic_merge': {str(k): v for k, v in TOPIC_MERGE.items()}, 'context_shuffle': CONTEXT_SHUFFLE, 'train_rows': len(train_rows),
          'batch': BATCH, 'max_len': MAX_LEN, 'params': sum(p.numel() for p in model.parameters()), 'history': history,
          'seconds': round(time.time() - t0), 'env': {'torch': torch.__version__, 'transformers': transformers.__version__,
          'gpu': torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'cpu'}})
(OUTPUT_DIR / 'eval_metrics.json').write_text(json.dumps(m, ensure_ascii=False, indent=2))
(OUTPUT_DIR / 'eval_cases.jsonl').write_text('\\n'.join(json.dumps(c, ensure_ascii=False) for c in cases))
print(json.dumps({k: m[k] for k in ('function', 'exact')}, indent=1))
print(json.dumps(m['per_function'], ensure_ascii=False, indent=1))
# 기능 확률이 낮은 행에서 틀림이 몰리는지: 임계값별 (걸러지는 비율, 남은 행의 exact)
for th in (0.5, 0.7, 0.9):
    kept = [c for c in cases if c['fn_conf'] >= th]
    print(f'fn_conf >= {th}: keep {len(kept) / len(cases):.3f}, exact among kept {sum(c["exact_correct"] for c in kept) / max(1, len(kept)):.4f}')
"""),
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
