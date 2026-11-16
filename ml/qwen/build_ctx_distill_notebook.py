"""Write the Colab notebook that labels train utterances under realistic app result-screen contexts with the Qwen teacher.

Why: the 10th classifier (distill + clf_v2) reached validation exact 91.5%, but on result-screen contexts shaped like the
real app's compact_context it still answered by context shortcuts (2026-11-16 local sweep, 336 cases):
  - every radish result carries `recapture` (top1 rule in backend/app/services/recapture.py), and 495 of the 519 train
    rows that have `recapture` are get_recapture_guidance, so "진단 결과 알려 줘" on a radish result became recapture guidance
  - one pepper anthracnose screen sent all diagnosis questions to care information
Qwen 2B answered those same cases correctly (298/336 vs classifier 239). So instead of more hand rules, put each train
utterance under several app-shaped contexts and let the teacher decide the call for each (context distillation).

  1. contexts  for train rows on the result screen (and a sample of distill_v2 paraphrases), build app-shaped contexts:
               the row's disease (or a random one), score and top-2, severity, saved/skipped, real pesticide names (0-5),
               and `recapture` exactly when the app would add it
  2. teacher   the deployed Qwen 2B soup labels every (utterance, context); its call becomes the label
  3. app test  28 everyday questions x 16 app-shaped contexts, also labelled by the teacher, kept out of training and
               read by the classifier notebook as `app_test`

Output: Drive cropy_qwen_v2/<OUT_NAME>/ctx_teacher.jsonl, app_test.jsonl, stats.json -> classifier notebook CTX_DIR.

    python build_ctx_distill_notebook.py        -> cropy_fs_ctx_distill_colab.ipynb
"""
import hashlib
import json
from pathlib import Path

import spec_v2

HERE = Path(__file__).resolve().parent
DATA_FILE = "qwen_v2c_data.jsonl.xz"
DATA_SHA = hashlib.sha256((HERE / "data_v2" / DATA_FILE).read_bytes()).hexdigest()
NOTEBOOK = "cropy_fs_ctx_distill_colab.ipynb"

SEED_DIR = HERE.parents[1] / "backend" / "app" / "data" / "seed"
_diseases = {d["key"]: d["name"] for d in json.loads((SEED_DIR / "diseases.json").read_text(encoding="utf-8"))}
_products = {x["key"]: x["name"] for x in json.loads((SEED_DIR / "pesticides.json").read_text(encoding="utf-8"))}
REAL_PESTICIDES = {}
for link in sorted(json.loads((SEED_DIR / "disease_pesticides.json").read_text(encoding="utf-8")), key=lambda x: x["priority"]):
    if link["pesticide_key"] in _products:
        REAL_PESTICIDES.setdefault(_diseases[link["disease_key"]], []).append(_products[link["pesticide_key"]])
DISEASES = [n for n in _diseases.values() if n != "판별 불가" and "정상" not in n]

# everyday questions for the held-out app test (not taken from the dataset)
APP_QUESTIONS = [
    "이거 무슨 병이야", "병 이름이 뭐야", "무슨 병이에요", "이게 뭔 병이야", "진단 결과 알려 줘", "결과가 뭐로 나왔어",
    "이 잎 무슨 병 걸린 거야", "어떤 병인지 말해 줘", "뭐라고 나왔어", "병명 다시 말해 줘", "이거 병 맞아", "얼마나 심해", "심각한 거야",
    "어떻게 관리해야 돼", "관리해야 돼", "관리 방법 알려 줘", "이제 뭐 해야 돼", "어떻게 하면 돼", "방제는 어떻게 해",
    "등록된 농약 목록 알려 줘", "등록된 농약 알려줘", "탄저병 약 추천해 줘", "쓸 수 있는 농약 뭐 있어", "농약 이름 알려 줘",
    "얼마나 확실해", "정확도 몇 퍼센트야", "점수가 몇 점이야", "다른 후보는 뭐야",
]


def md(text):
    return {"cell_type": "markdown", "metadata": {}, "source": text.strip("\n").splitlines(keepends=True)}


def code(text):
    return {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [],
            "source": text.strip("\n").splitlines(keepends=True)}


cells = [
    md("""
# Cropy 분류기용 화면 상태 정답 붙이기 (11차, Qwen 선생님)

10차 분류기는 validation exact 91.5%였지만, 실제 앱이 보내는 결과 화면 상태에서는 화면 상태만 보고 기능을 골랐다(11/16 로컬 336건 시험).
- 무 결과에는 앱이 항상 `recapture`를 넣는다. train에서 `recapture`가 있는 519행 중 495행이 재촬영 안내라 "진단 결과 알려 줘"도 재촬영 안내로 갔다.
- 고추 탄저병 화면 하나에서는 진단 질문이 모두 관리 방법으로 갔다.

같은 336건에서 Qwen 2B는 298건, 10차 분류기는 239건을 맞혔다. 그래서 규칙을 더 넣지 않고, train 발화마다 앱 형태의 화면 상태를 여러 개 붙여
**정답을 Qwen이 고르게** 한다.

1. **화면 상태 만들기:** 결과 화면 train 행(과 distill_v2 말 바꾼 문장 일부)에 그 행의 병(없으면 임의)으로 점수·상위 2개·심각도·저장 여부·
   실제 농약 이름(0~5개)을 채우고, `recapture`는 앱이 넣는 경우(무 두 병은 항상, 배추 두 병은 가끔)에만 넣는다.
2. **선생님 정답:** 배포 중인 Qwen 2B 평균 모델이 (발화, 화면 상태)마다 고른 호출을 라벨로 쓴다.
3. **앱 시험셋:** 일상 질문 28개 × 앱 형태 화면 상태 16개도 Qwen이 정답을 붙여 `app_test.jsonl`로 둔다. 학습에는 쓰지 않는다.

- 런타임: **L4 또는 A100**. 약 40~60분. 끊기면 Drive의 조각 파일부터 이어서 한다.
- 결과: Drive `cropy_qwen_v2/ctx_v1/` → 분류기 노트북의 `CTX_DIR`
"""),
    code(f"""
from google.colab import drive
drive.mount('/content/drive')

import copy, hashlib, json, lzma, os, random, re, time
from pathlib import Path
from collections import Counter

DRIVE_DIR = Path('/content/drive/MyDrive/cropy_qwen_v2')
DATA_FILE = DRIVE_DIR / '{DATA_FILE}'
DATA_SHA = '{DATA_SHA}'
TEACHER_DIR = DRIVE_DIR / 'soup_v2abc_v2d_6run' / 'merged_hf'   # 배포 중인 서버 모델
PARA_FILE = DRIVE_DIR / 'distill_v2' / 'paraphrases.jsonl'
SEED = 20261117
CTX_PER_ROW = 2          # train 행 하나에 붙일 화면 상태 수
N_PARA_ROWS = 12000      # 말 바꾼 문장 중 화면 상태를 붙일 수 (1개씩)
OUT = DRIVE_DIR / 'ctx_v1'
(OUT / 'parts').mkdir(parents=True, exist_ok=True)
assert (TEACHER_DIR / 'cropy_prompt.json').exists(), '선생님 모델이 Drive에 없습니다'
"""),
    code("""
import subprocess, sys
# 배포 모델 학습·평가 노트북과 같은 버전 (Qwen3.5 로딩이 확인된 조합)
subprocess.check_call([sys.executable, '-m', 'pip', 'uninstall', '-y', '-q', 'torchao'])
subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-q', 'transformers==5.19.0', 'accelerate==1.15.0', 'tokenizers==0.23.2'])
import torch, transformers
assert torch.cuda.is_available() and torch.cuda.is_bf16_supported(), 'L4 또는 A100 런타임을 선택하세요'
print(torch.__version__, transformers.__version__, torch.cuda.get_device_name(0))
"""),
    md("## 1. 앱 형태 화면 상태"),
    code(f"""
CONTEXT_KEYS = {json.dumps(list(spec_v2.CONTEXT_KEYS), ensure_ascii=False)}
REAL_PESTICIDES = {json.dumps(REAL_PESTICIDES, ensure_ascii=False)}
DISEASES = {json.dumps(DISEASES, ensure_ascii=False)}
APP_QUESTIONS = {json.dumps(APP_QUESTIONS, ensure_ascii=False)}
CROPS = ('고추', '배추', '무')
""" + """
def norm_name(name):
    return re.sub(r'^(고추|배추|무)\\s*', lambda m: m.group(1) + ' ', str(name).strip())

def crop_of(name):
    return next((c for c in CROPS if name.startswith(c)), None)

def recapture_for(d, rng):
    # backend/app/services/recapture.py: 무 검은무늬병·노균병은 1순위면 항상, 배추 두 병은 상위 두 후보가 쌍이고 차이가 좁을 때만
    if d in ('무 검은무늬병', '무 노균병'):
        return {'region': '잎 뒷면'}
    if d in ('배추 검은썩음병', '배추 노균병') and rng.random() < 0.3:
        return {'region': '잎맥·잎 가장자리'}
    return None

def app_context(rng, disease=None, keep=None):
    # frontend/src/features/voice/lib/voiceContext.ts compactContext 가 결과 화면에서 내는 모양
    d = disease if disease in DISEASES else rng.choice(DISEASES)
    c = crop_of(d)
    conf = round(rng.uniform(0.5, 0.99), 2)
    others = [x for x in DISEASES if crop_of(x) == c and x != d] or [x for x in DISEASES if x != d]
    ctx = {'ui_stage': 'result', 'selected_crop': c, 'predicted_crop': c, 'crop_mismatch': False, 'prediction_mode': 'model',
           'category': 'disease', 'disease_name': d, 'confidence': conf,
           'top_predictions': [{'name': d, 'confidence': conf},
                               {'name': rng.choice(others), 'confidence': round((1 - conf) * rng.uniform(0.3, 0.9), 2)}],
           'severity': rng.choice(['low', 'medium', 'high']), 'decision_status': 'disease',
           'save_status': 'saved' if rng.random() < 0.8 else 'skipped'}
    rc = recapture_for(d, rng)
    if rc:
        ctx['recapture'] = rc
    k = rng.choice([0, 2, 3, 5, 5])
    if k and REAL_PESTICIDES.get(d):
        ctx['pesticides'] = REAL_PESTICIDES[d][:k]
    for key, v in (keep or {}).items():
        ctx[key] = v
    return {key: ctx[key] for key in CONTEXT_KEYS if key in ctx}

def eligible(r):
    # 결과 화면 행만. 정상·판별 불가 결과와 제품 선택·되물음이 걸린 행은 원래 화면 상태가 답을 정하므로 그대로 둔다
    x = r['context']
    return (x.get('ui_stage') == 'result' and x.get('category') in (None, 'disease')
            and 'selected_usage_id' not in x and 'pending_target' not in x)

raw = DATA_FILE.read_bytes()
assert hashlib.sha256(raw).hexdigest() == DATA_SHA, '데이터 파일이 노트북을 만든 것과 다릅니다'
rows = [json.loads(l) for l in lzma.decompress(raw).decode('utf-8').splitlines()]
train_rows = [r for r in rows if r['split'] == 'train']
val_texts = {re.sub(r'\\s+', '', r['user_text']) for r in rows if r['split'] == 'validation'}
paras = [json.loads(l) for l in PARA_FILE.read_text(encoding='utf-8').splitlines()] if PARA_FILE.exists() else []
print(len(train_rows), 'train rows,', len(paras), 'paraphrases')

rng = random.Random(SEED)
src = [r for r in train_rows if eligible(r)]
psrc = [r for r in paras if eligible(r)]
psrc = rng.sample(psrc, min(N_PARA_ROWS, len(psrc)))
jobs = []
for r in src:
    for _ in range(CTX_PER_ROW):
        jobs.append((r, app_context(rng, norm_name(r['context'].get('disease_name', '')))))
for r in psrc:
    jobs.append((r, app_context(rng, norm_name(r['context'].get('disease_name', '')))))
print(len(src), 'train rows +', len(psrc), 'paraphrases eligible ->', len(jobs), 'teacher jobs')
print('recapture in new contexts:', sum('recapture' in c for _, c in jobs))

# 앱 시험셋: 일상 질문 x 화면 상태 16개 (다른 seed)
trng = random.Random(SEED + 1)
test_ctx = [app_context(trng) for _ in range(16)]
test_jobs = [(q, c) for q in APP_QUESTIONS for c in test_ctx]
print(len(test_jobs), 'app test cases')
for r, c in jobs[:3]:
    print(' ', r['user_text'], '|', json.dumps(c, ensure_ascii=False)[:200])
"""),
    md("## 2. 선생님(Qwen 2B) 정답"),
    code("""
from collections.abc import Mapping
from transformers import AutoTokenizer
PROMPT = json.loads((TEACHER_DIR / 'cropy_prompt.json').read_text(encoding='utf-8'))
FUNCTION_NAMES = list(PROMPT['functions'])
ttok = AutoTokenizer.from_pretrained(TEACHER_DIR)
if ttok.pad_token_id is None:
    ttok.pad_token = ttok.eos_token
END_ID = ttok.convert_tokens_to_ids(PROMPT['stop_token'])
teacher = transformers.Qwen3_5ForConditionalGeneration.from_pretrained(
    TEACHER_DIR, dtype=torch.bfloat16, attn_implementation='sdpa').to('cuda').eval()
CALL = re.compile(r'^<hs_(\\d+)>\\(((?:[a-z_]+=-?\\d+(?:, [a-z_]+=-?\\d+)*)?)\\)<hs_end>$')

def prompt_ids(text, context):
    user = json.dumps({'utterance': text, 'context': context}, ensure_ascii=False, separators=(',', ':'))
    ids = ttok.apply_chat_template([{'role': 'system', 'content': PROMPT['system_prompt']}, {'role': 'user', 'content': user}],
                                   tokenize=True, add_generation_prompt=True, enable_thinking=False)
    if isinstance(ids, Mapping):
        ids = ids['input_ids']
    ids = ids.tolist() if hasattr(ids, 'tolist') else list(ids)
    return ids[0] if ids and isinstance(ids[0], list) else ids

def ask(items, batch_size=32):
    # items: [(text, context)] -> calls. 길이순으로 묶어 패딩을 줄인다
    order = sorted(range(len(items)), key=lambda i: len(prompt_ids(*items[i])))
    calls = [None] * len(items)
    with torch.no_grad():
        for s in range(0, len(order), batch_size):
            idx = order[s:s + batch_size]
            prompts = [prompt_ids(*items[i]) for i in idx]
            n = max(map(len, prompts))
            ids = torch.tensor([[ttok.pad_token_id] * (n - len(p)) + p for p in prompts], device='cuda')
            mask = torch.tensor([[0] * (n - len(p)) + [1] * len(p) for p in prompts], device='cuda')
            gen = teacher.generate(input_ids=ids, attention_mask=mask, max_new_tokens=16, do_sample=False,
                                   eos_token_id=[END_ID, ttok.eos_token_id], pad_token_id=ttok.pad_token_id)
            for i, seq in zip(idx, gen[:, n:].tolist()):
                cut = seq.index(END_ID) + 1 if END_ID in seq else len(seq)
                calls[i] = ttok.decode(seq[:cut], skip_special_tokens=False).strip()
    return calls

def function_of(call):
    m = CALL.match(call or '')
    return FUNCTION_NAMES[int(m.group(1))] if m and int(m.group(1)) < len(FUNCTION_NAMES) else None

# 선생님이 원래 train 행을 맞히는지 먼저 본다
probe = random.Random(SEED).sample(train_rows, 256)
probe_calls = ask([(r['user_text'], r['context']) for r in probe])
print('teacher on original train sample:', sum(c == r['output'] for c, r in zip(probe_calls, probe)) / len(probe))

TPART = 2048
t0 = time.time()
for k in range(0, len(jobs), TPART):
    path = OUT / 'parts' / f'ctx_{k // TPART:04d}.jsonl'
    if path.exists():
        continue
    chunk = jobs[k:k + TPART]
    calls = ask([(r['user_text'], c) for r, c in chunk])
    path.write_text('\\n'.join(json.dumps({'i': k + j, 'call': call}, ensure_ascii=False) for j, call in enumerate(calls)), encoding='utf-8')
    print(f'{min(k + TPART, len(jobs))}/{len(jobs)} labelled, {time.time() - t0:.0f}s')

test_calls = ask(test_jobs)
"""),
    md("## 3. 저장"),
    code("""
calls = {}
for path in sorted((OUT / 'parts').glob('ctx_*.jsonl')):
    for line in path.read_text(encoding='utf-8').splitlines():
        o = json.loads(line); calls[o['i']] = o['call']
kept, stats, changed = [], Counter(), Counter()
for i, (r, c) in enumerate(jobs):
    call = calls.get(i)
    fn = function_of(call)
    stats['labelled'] += 1
    if fn is None:
        stats['invalid_call'] += 1; continue
    if re.sub(r'\\s+', '', r['user_text']) in val_texts:
        stats['in_validation'] += 1; continue
    stats['same_as_original'] += call == r['output']
    if fn != r['function']:
        changed[(r['function'], fn)] += 1
    n = copy.deepcopy(r)
    n.update(context=c, function=fn, output=call, parent_case_id=r.get('parent_case_id', r['case_id']),
             case_id=f"{r['case_id']}~ctx{i}", augmentation=f"{r.get('augmentation')}+ctx_teacher")
    kept.append(n)
stats['kept'] = len(kept)
per_fn = Counter(r['function'] for r in kept)
print(dict(stats)); print(per_fn)
print('function changed by the new context (original -> teacher), top 15:')
for (a, b), n in changed.most_common(15):
    print(f'  {a} -> {b}: {n}')

test_rows = []
for i, ((q, c), call) in enumerate(zip(test_jobs, test_calls)):
    fn = function_of(call)
    if fn is None:
        continue
    test_rows.append({'case_id': f'app{i}', 'split': 'app_test', 'user_text': q, 'context': c, 'function': fn, 'output': call})
print(len(test_rows), 'app test rows', Counter(r['function'] for r in test_rows))

(OUT / 'ctx_teacher.jsonl').write_text('\\n'.join(json.dumps(r, ensure_ascii=False) for r in kept), encoding='utf-8')
(OUT / 'app_test.jsonl').write_text('\\n'.join(json.dumps(r, ensure_ascii=False) for r in test_rows), encoding='utf-8')
(OUT / 'stats.json').write_text(json.dumps({'stats': dict(stats), 'per_function': dict(per_fn),
                                            'changed': {f'{a}->{b}': n for (a, b), n in changed.most_common()},
                                            'teacher': str(TEACHER_DIR), 'seed': SEED, 'ctx_per_row': CTX_PER_ROW,
                                            'n_para_rows': N_PARA_ROWS, 'app_test': len(test_rows)}, ensure_ascii=False, indent=1))
for r in random.Random(0).sample(kept, min(10, len(kept))):
    print(r['user_text'], '|', r['output'], '|', r['context'].get('disease_name'), 'recapture' in r['context'])
"""),
]

nb = {"cells": cells, "metadata": {"kernelspec": {"display_name": "Python 3", "name": "python3"},
                                   "language_info": {"name": "python"}, "accelerator": "GPU"},
      "nbformat": 4, "nbformat_minor": 5}
(HERE / NOTEBOOK).write_text(json.dumps(nb, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")
print(NOTEBOOK, "data sha", DATA_SHA[:12])
