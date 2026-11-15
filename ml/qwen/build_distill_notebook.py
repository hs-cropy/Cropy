"""Write the Colab notebook that makes teacher-checked paraphrases for the function-selection classifier.

Why: the small classifier (KoELECTRA-small, 14M) reaches 88.8% exact on validation while Qwen 2B reaches 97% on the
same data; a bigger encoder did not help (88.7%), so the limit is the 5,062 training sentences. This notebook makes
many more sentences without new human labels:

  1. paraphrase  every train utterance N times with an instruct LLM (Qwen2.5-7B-Instruct, sampling)
  2. teacher     ask the deployed Qwen 2B soup (validation 97.07%) what it would call for each paraphrase,
                 with the original row's context
  3. keep        only paraphrases where the teacher's call equals the original label (meaning kept),
                 and drop any sentence that also appears in validation

Output: Drive cropy_qwen_v2/<OUT_NAME>/paraphrases.jsonl (one row per kept paraphrase, same fields as the dataset
rows plus parent_case_id) and stats.json. build_classifier_notebook.py reads it with DISTILL_DIR.
Validation is never paraphrased.

    python build_distill_notebook.py        -> cropy_fs_distill_data_colab.ipynb
"""
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA_FILE = "qwen_v2c_data.jsonl.xz"
DATA_SHA = hashlib.sha256((HERE / "data_v2" / DATA_FILE).read_bytes()).hexdigest()
NOTEBOOK = "cropy_fs_distill_data_colab.ipynb"


def md(text):
    return {"cell_type": "markdown", "metadata": {}, "source": text.strip("\n").splitlines(keepends=True)}


def code(text):
    return {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [],
            "source": text.strip("\n").splitlines(keepends=True)}


cells = [
    md(f"""
# Cropy 분류기용 문장 늘리기 (말 바꾸기 + Qwen 선생님 확인)

분류기(14M)는 validation exact 88.8%, 같은 데이터의 Qwen 2B는 97%다. 인코더를 키워도(110M) 오르지 않아 학습 문장 5,062개가 한계로 본다.

1. **말 바꾸기:** train 발화마다 같은 뜻의 다른 말투 문장을 `N_PARA`개 만든다(Qwen2.5-7B-Instruct, 샘플링). 작물·병명·제품 이름과 숫자는 그대로 둔다.
2. **선생님 확인:** 배포 중인 Qwen 2B 평균 모델(`soup_v2abc_v2d_6run`, validation 97.07%)에게 원래 행의 화면 상태와 함께 물어
   원래 라벨과 **같은 호출**을 낸 문장만 남긴다(뜻이 바뀐 문장 제거).
3. validation에 있는 문장과 같으면 버린다. validation은 손대지 않는다.

- 런타임: **A100**. 말 바꾸기 약 30~50분, 선생님 확인 약 30~60분. 중간에 끊겨도 Drive의 조각 파일부터 이어서 한다.
- 결과: Drive `cropy_qwen_v2/<OUT_NAME>/paraphrases.jsonl`, `stats.json` → 분류기 노트북의 `DISTILL_DIR`
"""),
    code(f"""
from google.colab import drive
drive.mount('/content/drive')

import hashlib, json, lzma, os, random, re, time
from pathlib import Path
from collections import Counter

DRIVE_DIR = Path('/content/drive/MyDrive/cropy_qwen_v2')
DATA_FILE = DRIVE_DIR / '{DATA_FILE}'
DATA_SHA = '{DATA_SHA}'
TEACHER_DIR = DRIVE_DIR / 'soup_v2abc_v2d_6run' / 'merged_hf'   # 배포 중인 서버 모델
PARAPHRASER = 'Qwen/Qwen2.5-7B-Instruct'
N_PARA = 8
SEED = 20261116
OUT_NAME = 'distill_v2'   # v1(11/16)은 문장을 1개만 내거나 중국어가 섞여 중단
OUT = DRIVE_DIR / OUT_NAME
(OUT / 'parts').mkdir(parents=True, exist_ok=True)
assert (TEACHER_DIR / 'cropy_prompt.json').exists(), '선생님 모델이 Drive에 없습니다'
"""),
    code("""
import subprocess, sys
# 배포 모델 학습·평가 노트북과 같은 버전 (Qwen3.5 로딩이 확인된 조합)
subprocess.check_call([sys.executable, '-m', 'pip', 'uninstall', '-y', '-q', 'torchao'])
subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-q', 'transformers==5.19.0', 'accelerate==1.15.0', 'tokenizers==0.23.2'])
import torch, transformers
assert torch.cuda.is_available() and torch.cuda.is_bf16_supported(), 'A100 런타임을 선택하세요'
print(torch.__version__, transformers.__version__, torch.cuda.get_device_name(0))
"""),
    md("## 데이터"),
    code("""
raw = DATA_FILE.read_bytes()
assert hashlib.sha256(raw).hexdigest() == DATA_SHA, '데이터 파일이 노트북을 만든 것과 다릅니다'
rows = [json.loads(l) for l in lzma.decompress(raw).decode('utf-8').splitlines()]
train_rows = [r for r in rows if r['split'] == 'train']
val_texts = {re.sub(r'\\s+', '', r['user_text']) for r in rows if r['split'] == 'validation'}
# 같은 발화가 여러 행에 있으면(화면 상태만 다름) 말 바꾸기는 한 번만 한다
by_text = {}
for r in train_rows:
    by_text.setdefault(r['user_text'], []).append(r)
texts = sorted(by_text)
print(len(train_rows), 'train rows,', len(texts), 'distinct utterances')
"""),
    md("## 1. 말 바꾸기"),
    code("""
from transformers import AutoTokenizer, AutoModelForCausalLM
ptok = AutoTokenizer.from_pretrained(PARAPHRASER)
ptok.padding_side = 'left'
pmodel = AutoModelForCausalLM.from_pretrained(PARAPHRASER, dtype=torch.bfloat16, device_map='cuda').eval()

INSTRUCT = (
    '당신은 한국 농민의 말투를 잘 아는 한국어 도우미입니다. 반드시 한국어로만 답합니다.\\n'
    '사용자가 주는 문장은 농민이 작물 병해 진단 앱에 음성으로 한 말입니다. '
    f'같은 뜻의 다른 한국어 문장을 정확히 {N_PARA}개 만드세요.\\n'
    '- 뜻(무엇을 묻거나 시키는지)은 바꾸지 마세요. 내용을 더하거나 빼지 마세요.\\n'
    '- 작물 이름, 병 이름, 제품 이름, 숫자, "목록의", "A", "B" 같은 지칭은 그대로 두세요.\\n'
    '- 존댓말·반말, 짧은 말·긴 말, 어순 바꾸기, 말할 때의 군더더기("그", "저기", "음")를 섞으세요.\\n'
    f'- "1."부터 "{N_PARA}."까지 번호를 붙여 한 줄에 한 문장씩만 쓰고, 다른 설명은 쓰지 마세요.'
)
# 예시 한 쌍을 대화로 보여 줘 개수·형식을 지키게 한다 (v1은 256문장 중 188개가 1문장만 냈다)
EXAMPLE_IN = '고추 탄저병에 쓸 약 알려 줘'
EXAMPLE_OUT = '\\n'.join(f'{i}. {t}' for i, t in enumerate([
    '고추 탄저병에 뿌릴 약 좀 알려 주세요', '탄저병 걸린 고추에는 무슨 약 써요', '고추 탄저병 약 뭐 있어',
    '저기 고추 탄저병에 쓰는 약이 뭐예요', '고추 탄저병 잡는 약 알려 줄래', '고추 탄저병에는 어떤 약을 써야 돼요',
    '음 고추 탄저병 약 이름 좀 말해 줘', '고추에 탄저병 왔는데 약 뭐 쓰면 돼'][:N_PARA], 1))

def para_prompt(t):
    msgs = [{'role': 'system', 'content': INSTRUCT}, {'role': 'user', 'content': EXAMPLE_IN},
            {'role': 'assistant', 'content': EXAMPLE_OUT}, {'role': 'user', 'content': t}]
    return ptok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)

# v1은 중국어 문장이 섞였다. 한자·일본어가 있거나 한글 비율이 낮은 줄은 버린다
FOREIGN = re.compile('[\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff]')
DROPPED = Counter()
def clean(line):
    line = re.sub(r'^\\s*(?:\\d+[.)]|[-*•])\\s*', '', line).strip().strip('"').strip()
    if not 2 <= len(line) <= 80:
        return None
    letters = [c for c in line if c.isalpha()]
    if FOREIGN.search(line) or not letters or sum('가' <= c <= '힣' for c in letters) / len(letters) < 0.7:
        DROPPED['not_korean'] += 1
        return None
    return line

PART = 256
def para_part(k):
    return OUT / 'parts' / f'para_{k:04d}.jsonl'

torch.manual_seed(SEED)
t0 = time.time()
for k in range(0, len(texts), PART):
    path = para_part(k // PART)
    if path.exists():
        continue
    chunk = texts[k:k + PART]
    out = []
    for s in range(0, len(chunk), 32):
        batch = chunk[s:s + 32]
        enc = ptok([para_prompt(t) for t in batch], return_tensors='pt', padding=True).to('cuda')
        with torch.no_grad():
            gen = pmodel.generate(**enc, max_new_tokens=400, do_sample=True, temperature=0.7, top_p=0.9, repetition_penalty=1.05,
                                  pad_token_id=ptok.pad_token_id or ptok.eos_token_id)
        for t, seq in zip(batch, gen[:, enc['input_ids'].shape[1]:]):
            lines = [clean(l) for l in ptok.decode(seq, skip_special_tokens=True).splitlines()]
            uniq = []
            for l in lines:
                if l and l != t and l not in uniq:
                    uniq.append(l)
            out.append({'text': t, 'paraphrases': uniq[:N_PARA]})
    path.write_text('\\n'.join(json.dumps(o, ensure_ascii=False) for o in out), encoding='utf-8')
    avg = sum(len(o['paraphrases']) for o in out) / len(out)
    full = sum(len(o['paraphrases']) == N_PARA for o in out)
    print(f'{min(k + PART, len(texts))}/{len(texts)} utterances, {time.time() - t0:.0f}s | 평균 {avg:.1f}문장, {N_PARA}개 다 {full}/{len(out)}, 버린 줄 {dict(DROPPED)}')
    for o in out[:2]:
        print('  ', o['text'], '->', o['paraphrases'][:3])

paras = {}
for path in sorted((OUT / 'parts').glob('para_*.jsonl')):
    for line in path.read_text(encoding='utf-8').splitlines():
        o = json.loads(line); paras[o['text']] = o['paraphrases']
print('paraphrased', len(paras), 'utterances,', sum(map(len, paras.values())), 'sentences')
for t in texts[:5]:
    print(t, '->', paras.get(t, [])[:3])
del pmodel; torch.cuda.empty_cache()
"""),
    md("## 2. 선생님(Qwen 2B) 확인\n원래 행의 화면 상태로 물어 원래 라벨과 같은 호출을 낸 문장만 남긴다."),
    code("""
from collections.abc import Mapping
PROMPT = json.loads((TEACHER_DIR / 'cropy_prompt.json').read_text(encoding='utf-8'))
ttok = AutoTokenizer.from_pretrained(TEACHER_DIR)
if ttok.pad_token_id is None:
    ttok.pad_token = ttok.eos_token
END_ID = ttok.convert_tokens_to_ids(PROMPT['stop_token'])
teacher = transformers.Qwen3_5ForConditionalGeneration.from_pretrained(
    TEACHER_DIR, dtype=torch.bfloat16, attn_implementation='sdpa').to('cuda').eval()

def prompt_ids(text, context):
    user = json.dumps({'utterance': text, 'context': context}, ensure_ascii=False, separators=(',', ':'))
    ids = ttok.apply_chat_template([{'role': 'system', 'content': PROMPT['system_prompt']}, {'role': 'user', 'content': user}],
                                   tokenize=True, add_generation_prompt=True, enable_thinking=False)
    if isinstance(ids, Mapping):
        ids = ids['input_ids']
    ids = ids.tolist() if hasattr(ids, 'tolist') else list(ids)
    return ids[0] if ids and isinstance(ids[0], list) else ids

def ask(items, batch_size=32):
    # items: [(text, context)] -> calls. 길이순으로 묶어 패딩을 줄인다 (배포 평가에서 batch 16 결과가 한 건씩과 같았다)
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

# 선생님이 원래 train 행을 맞히는지 먼저 본다 (너무 낮으면 필터가 좋은 문장까지 버린다)
probe = random.Random(SEED).sample(train_rows, 256)
probe_calls = ask([(r['user_text'], r['context']) for r in probe])
print('teacher on original train sample:', sum(c == r['output'] for c, r in zip(probe_calls, probe)) / len(probe))

# 말 바꾼 문장 x 그 발화를 가진 train 행(화면 상태). 행이 많으면 2개까지만 쓴다
jobs = []
for t, ps in paras.items():
    for r in by_text.get(t, [])[:2]:
        for p in ps:
            jobs.append((p, r))
print(len(jobs), 'teacher checks')

TPART = 2048
t0 = time.time()
for k in range(0, len(jobs), TPART):
    path = OUT / 'parts' / f'teach_{k // TPART:04d}.jsonl'
    if path.exists():
        continue
    chunk = jobs[k:k + TPART]
    calls = ask([(p, r['context']) for p, r in chunk])
    path.write_text('\\n'.join(json.dumps({'text': p, 'case_id': r['case_id'], 'call': c}, ensure_ascii=False)
                              for (p, r), c in zip(chunk, calls)), encoding='utf-8')
    print(f'{min(k + TPART, len(jobs))}/{len(jobs)} checked, {time.time() - t0:.0f}s')
"""),
    md("## 3. 남길 문장 고르기"),
    code("""
by_case = {r['case_id']: r for r in train_rows}
kept, stats = [], Counter()
seen = set()
for path in sorted((OUT / 'parts').glob('teach_*.jsonl')):
    for line in path.read_text(encoding='utf-8').splitlines():
        o = json.loads(line); r = by_case[o['case_id']]
        stats['checked'] += 1
        if FOREIGN.search(o['text']):
            stats['not_korean'] += 1; continue
        if re.sub(r'\\s+', '', o['text']) in val_texts:
            stats['in_validation'] += 1; continue
        if o['call'] != r['output']:
            stats['teacher_disagrees'] += 1; continue
        key = (o['text'], o['case_id'])
        if key in seen:
            continue
        seen.add(key)
        n = dict(r)
        n.update(user_text=o['text'], parent_case_id=r['case_id'], case_id=f"{r['case_id']}~para{len(kept)}",
                 augmentation=f"{r.get('augmentation')}+paraphrase")
        kept.append(n)
stats['kept'] = len(kept)
per_fn = Counter(r['function'] for r in kept)
print(dict(stats)); print(per_fn)
(OUT / 'paraphrases.jsonl').write_text('\\n'.join(json.dumps(r, ensure_ascii=False) for r in kept), encoding='utf-8')
(OUT / 'stats.json').write_text(json.dumps({'stats': dict(stats), 'per_function': dict(per_fn), 'paraphraser': PARAPHRASER,
                                            'teacher': str(TEACHER_DIR), 'n_para': N_PARA, 'seed': SEED}, ensure_ascii=False, indent=1))
for r in random.Random(0).sample(kept, min(10, len(kept))):
    print(r['user_text'], '|', r['output'])
"""),
]

nb = {"cells": cells, "metadata": {"kernelspec": {"display_name": "Python 3", "name": "python3"},
                                   "language_info": {"name": "python"}, "accelerator": "GPU"},
      "nbformat": 4, "nbformat_minor": 5}
(HERE / NOTEBOOK).write_text(json.dumps(nb, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")
print(NOTEBOOK, "data sha", DATA_SHA[:12])
