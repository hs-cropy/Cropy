"""Write the Colab notebook that merges trained adapters without further training.

Output
  cropy_qwen_v2_merge_eval_colab.ipynb   upload to Drive MyDrive/cropy_qwen_v2/ and run on Colab GPU

What the notebook does (validation = qwen_v2c_data.jsonl.xz, the labels every run is compared on)
  1. merge  the chosen adapter (v2_r16_e2) into the base model, check it answers like the adapter, and save
            it as a plain Hugging Face model for the RKLLM conversion on the board
  2. soup   average the merged weights of the three long-prompt runs (v2, v2b, v2c) into one model and
            evaluate it; a 3-run majority vote reached 96.6% exact against 95.0% for v2 alone
"""
import hashlib
import json
from pathlib import Path

import build_train_notebook as train
import spec_v2

HERE = Path(__file__).resolve().parent
RUNS = ["v2_r16_e2", "v2b_r16_e2", "v2c_r16_e2"]  # same base, prompt and new-token ids; v3s used another prompt
EXPORT = "v2_r16_e2"  # adapter chosen for the server (README "v2c 결과와 결정")


def notebook(data_sha, counts):
    assert not train.SHORT_PROMPT
    system = spec_v2.system_prompt()
    table = {name: [[arg, len(values)] for arg, values in args.items()] for name, args, _ in spec_v2.FUNCTIONS}
    md, code = train.md, train.code
    cells = [
        md(f"""
# Cropy Qwen 어댑터 병합 · 평균(모델 수프) 평가

학습은 하지 않는다. 이미 학습한 어댑터만 쓴다.

1. **병합**: `{EXPORT}` 어댑터를 기본 모델에 합쳐 어댑터와 같은 답을 내는지 확인하고, 보드 RKLLM 변환용 Hugging Face 모델로 저장한다.
2. **평균**: {', '.join(f'`{r}`' for r in RUNS)} 세 모델의 병합 가중치를 평균 낸 한 모델을 평가한다. 세 모델 다수결은 인자까지 96.6%였다(`{EXPORT}` 단독 95.0%).

- 평가 기준: `{train.DATA_FILE}`의 validation {counts['validation']:,}행(학습 결과 비교에 써 온 라벨)
- 런타임: **A100**, 메뉴 런타임 → 모두 실행. 결과는 `cropy_qwen_v2/merge_eval/`, 병합 모델은 `cropy_qwen_v2/{EXPORT}/merged_hf/`(약 4~5GB, Drive 여유 공간 확인).
"""),
        code(f"""
from google.colab import drive
drive.mount('/content/drive')
from pathlib import Path
import json, hashlib, lzma, os, re, sys, subprocess, random, gc, time

DRIVE_DIR = Path('/content/drive/MyDrive/cropy_qwen_v2')
DATA_FILE = DRIVE_DIR / '{train.DATA_FILE}'
DATA_SHA256 = '{data_sha}'
MODEL_ID = '{train.MODEL_ID}'
MODEL_REF = '{train.MODEL_REF}'
RUNS = {RUNS!r}
EXPORT = '{EXPORT}'
SAVE_MERGED = True          # False면 병합 모델을 Drive에 저장하지 않는다
OUT = DRIVE_DIR / 'merge_eval'
OUT.mkdir(parents=True, exist_ok=True)
for run in RUNS:
    assert (DRIVE_DIR / run / 'adapter' / 'adapter_config.json').exists(), f'{{run}} 어댑터가 Drive에 없습니다'
print('결과 폴더', OUT)
"""),
        code("""
subprocess.check_call([sys.executable, '-m', 'pip', 'uninstall', '-y', '-q', 'torchao'])
subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-q', 'transformers==5.19.0', 'peft==0.21.2',
                       'accelerate==1.15.0', 'tokenizers==0.23.2'])
import torch, transformers, peft
from transformers import AutoTokenizer
from peft import PeftModel
from collections import Counter
from collections.abc import Mapping
assert torch.cuda.is_available(), 'GPU 런타임을 선택하세요'
assert torch.cuda.is_bf16_supported(), 'bf16을 지원하는 GPU(A100·L4)를 선택하세요'
DTYPE = torch.bfloat16
ENV = dict(torch=torch.__version__, transformers=transformers.__version__, peft=peft.__version__,
           gpu=torch.cuda.get_device_name(0))
print(ENV)
"""),
        md("## 데이터와 평가 함수 (학습 노트북과 같음)"),
        code(f"""
raw = DATA_FILE.read_bytes()
assert hashlib.sha256(raw).hexdigest() == DATA_SHA256, '데이터 파일이 노트북과 다릅니다'
rows = [json.loads(l) for l in lzma.decompress(raw).decode('utf-8').splitlines()]
val_rows = [r for r in rows if r['split'] == 'validation']
assert len(val_rows) == {counts['validation']}

SYSTEM_PROMPT = {system!r}
FUNCTIONS = {json.dumps(table, ensure_ascii=False)}
NAMES = list(FUNCTIONS)
NEW_TOKENS = [f'<hs_{{i}}>' for i in range(len(NAMES))] + ['<hs_end>']
CALL = re.compile(r'^<hs_(\\d+)>\\(((?:[a-z_]+=-?\\d+(?:, [a-z_]+=-?\\d+)*)?)\\)<hs_end>$')

def parse_call(text):
    m = CALL.match(text.strip())
    if not m or int(m.group(1)) >= len(NAMES):
        return None
    name = NAMES[int(m.group(1))]
    given = [p.split('=') for p in m.group(2).split(', ')] if m.group(2) else []
    if [k for k, _ in given] != [a for a, _ in FUNCTIONS[name]]:
        return None
    if any(not 1 <= int(v) <= n for (_, v), (_, n) in zip(given, FUNCTIONS[name])):
        return None
    return name, tuple(int(v) for _, v in given)
"""),
        code("""
# Every run saved the same tokenizer (base + 10 new tokens); check before mixing their weights.
tokenizer = AutoTokenizer.from_pretrained(DRIVE_DIR / EXPORT / 'adapter')
TOKEN_IDS = {t: tokenizer.encode(t, add_special_tokens=False) for t in NEW_TOKENS}
assert all(len(v) == 1 for v in TOKEN_IDS.values()), TOKEN_IDS
TOKEN_IDS = {t: v[0] for t, v in TOKEN_IDS.items()}
for run in RUNS:
    tok = AutoTokenizer.from_pretrained(DRIVE_DIR / run / 'adapter')
    assert all(tok.encode(t, add_special_tokens=False) == [i] for t, i in TOKEN_IDS.items()), run
END_ID = TOKEN_IDS['<hs_end>']
BASE_EOS = tokenizer.eos_token_id
if tokenizer.pad_token_id is None:
    tokenizer.pad_token = tokenizer.eos_token

def prompt_ids(r):
    user = json.dumps({'utterance': r['user_text'], 'context': r['context']}, ensure_ascii=False, separators=(',', ':'))
    ids = tokenizer.apply_chat_template([{'role': 'system', 'content': SYSTEM_PROMPT}, {'role': 'user', 'content': user}],
                                        tokenize=True, add_generation_prompt=True, enable_thinking=False)
    if isinstance(ids, Mapping):
        ids = ids['input_ids']
    if hasattr(ids, 'tolist'):
        ids = ids.tolist()
    if ids and isinstance(ids[0], list):
        ids = ids[0]
    return list(ids)

def generate(m, rows, batch_size):
    m.eval()
    dev = m.get_input_embeddings().weight.device
    order = sorted(range(len(rows)), key=lambda i: len(prompt_ids(rows[i])))
    texts = [None] * len(rows)
    with torch.no_grad():
        for s in range(0, len(order), batch_size):
            idx = order[s:s + batch_size]
            prompts = [prompt_ids(rows[i]) for i in idx]
            n = max(map(len, prompts))
            ids = torch.tensor([[tokenizer.pad_token_id] * (n - len(p)) + p for p in prompts], device=dev)
            mask = torch.tensor([[0] * (n - len(p)) + [1] * len(p) for p in prompts], device=dev)
            gen = m.generate(input_ids=ids, attention_mask=mask, max_new_tokens=16, do_sample=False,
                             eos_token_id=[END_ID, BASE_EOS], pad_token_id=tokenizer.pad_token_id, use_cache=True)
            for i, seq in zip(idx, gen[:, n:].tolist()):
                cut = seq.index(END_ID) + 1 if END_ID in seq else next((j for j, t in enumerate(seq) if t in (BASE_EOS, tokenizer.pad_token_id)), len(seq))
                texts[i] = tokenizer.decode(seq[:cut], skip_special_tokens=False).strip()
    return texts

def evaluate(m):
    probe = val_rows[:32]
    batch = 16 if generate(m, probe, 1) == generate(m, probe, 16) else 1
    start = time.time()
    texts = generate(m, val_rows, batch)
    return texts, dict(batch_generation=batch, seconds=round(time.time() - start))

def score(texts):
    cases = []
    for r, t in zip(val_rows, texts):
        got, gold = parse_call(t), parse_call(r['output'])
        cases.append(dict(case_id=r['case_id'], augmentation=r['augmentation'], user_text=r['user_text'],
                          expected=r['output'], actual=t, expected_function=r['function'],
                          actual_function=got[0] if got else None, format_valid=got is not None,
                          function_correct=bool(got) and got[0] == gold[0], exact_correct=t == r['output']))
    rate = lambda cs, key: round(sum(c[key] for c in cs) / max(1, len(cs)), 4)
    per = {f: dict(support=len(cs), function=rate(cs, 'function_correct'), exact=rate(cs, 'exact_correct'))
           for f in sorted({c['expected_function'] for c in cases}) for cs in [[c for c in cases if c['expected_function'] == f]]}
    return cases, dict(support=len(cases), format_valid=rate(cases, 'format_valid'), function=rate(cases, 'function_correct'),
                       exact=rate(cases, 'exact_correct'), per_function=per)

def saved_outputs(run):
    return {c['case_id']: c['actual'] for c in map(json.loads, (DRIVE_DIR / run / 'eval_cases.jsonl').read_text(encoding='utf-8').splitlines())}

def write(name, cases, metrics):
    (OUT / f'{name}_metrics.json').write_text(json.dumps(metrics, ensure_ascii=False, indent=2))
    with (OUT / f'{name}_cases.jsonl').open('w', encoding='utf-8') as f:
        for c in cases:
            f.write(json.dumps(c, ensure_ascii=False) + '\\n')
    print(name, json.dumps({k: metrics[k] for k in ('format_valid', 'function', 'exact')}))

MODEL_CLASS = getattr(transformers, 'Qwen3_5ForConditionalGeneration')

def load_base():
    m = MODEL_CLASS.from_pretrained(MODEL_ID, revision=MODEL_REF, device_map={'': 0}, dtype=DTYPE, attn_implementation='sdpa')
    m.resize_token_embeddings(max(len(tokenizer), m.get_input_embeddings().num_embeddings))  # same as training
    return m

def load_merged(run):
    return PeftModel.from_pretrained(load_base(), DRIVE_DIR / run / 'adapter', is_trainable=False).merge_and_unload()
"""),
        md(f"""
## 1. 병합 (`{EXPORT}`)
어댑터를 기본 가중치에 더해 일반 모델로 만든다. 어댑터로 평가했을 때 저장한 답(`{EXPORT}/eval_cases.jsonl`)과 얼마나 같은지 본다.
bf16에서 더하는 순서가 달라 몇 건은 달라질 수 있다.
"""),
        code("""
merged = load_merged(EXPORT)
merged.config.use_cache = True
texts, run_info = evaluate(merged)
cases, metrics = score(texts)
before = saved_outputs(EXPORT)
same = sum(c['actual'] == before[c['case_id']] for c in cases)
metrics |= dict(run=EXPORT, same_as_adapter=same, env=ENV, **run_info)
write('merged_' + EXPORT, cases, metrics)
print(f'어댑터 평가와 같은 답 {same}/{len(cases)}')
"""),
        code("""
if SAVE_MERGED:
    check = val_rows[:64]
    expected = generate(merged, check, 1)
    MERGED_DIR = DRIVE_DIR / EXPORT / 'merged_hf'
    merged.save_pretrained(MERGED_DIR, safe_serialization=True, max_shard_size='2GB')
    tokenizer.save_pretrained(MERGED_DIR)
    (MERGED_DIR / 'cropy_prompt.json').write_text(json.dumps(
        dict(system_prompt=SYSTEM_PROMPT, functions=FUNCTIONS, new_tokens=TOKEN_IDS, user_format='{"utterance":...,"context":...}',
             enable_thinking=False, stop_token='<hs_end>', base=MODEL_ID, revision=MODEL_REF, adapter=EXPORT),
        ensure_ascii=False, indent=2))
    del merged; gc.collect(); torch.cuda.empty_cache()
    reloaded = MODEL_CLASS.from_pretrained(MERGED_DIR, device_map={'': 0}, dtype=DTYPE, attn_implementation='sdpa')
    ok = generate(reloaded, check, 1) == expected
    (OUT / 'merged_reload_check.json').write_text(json.dumps({'cases': len(check), 'outputs_equal': ok}))
    print('저장', MERGED_DIR, '| 다시 불러온 결과가 같은가:', ok)
    del reloaded
else:
    del merged
gc.collect(); torch.cuda.empty_cache()
"""),
        md("""
## 2. 평균 (모델 수프)
세 run을 각각 병합한 가중치를 평균 낸다(기본 가중치 + 세 변화량의 평균과 같다). 새 토큰 임베딩도 평균 낸다.
CPU 메모리에 float32로 더하므로 RAM이 넉넉한 런타임이 좋다(약 20GB).
"""),
        code("""
total = None
for run in RUNS:
    m = load_merged(run)
    sd = m.state_dict()
    if total is None:
        total = {k: v.detach().float().cpu().clone() for k, v in sd.items()}
    else:
        assert sd.keys() == total.keys(), run
        for k, v in sd.items():
            total[k] += v.detach().float().cpu()
    del m, sd; gc.collect(); torch.cuda.empty_cache()
    print('더함', run)
soup = load_base()
missing, unexpected = soup.load_state_dict({k: (v / len(RUNS)).to(DTYPE) for k, v in total.items()}, strict=False)
assert not unexpected, unexpected[:5]
assert all('lm_head' in k for k in missing), missing[:5]  # tied to the embeddings
del total; gc.collect()
soup.config.use_cache = True
texts, run_info = evaluate(soup)
cases, metrics = score(texts)
metrics |= dict(runs=RUNS, env=ENV, **run_info)
write('soup_' + '_'.join(r.split('_')[0] for r in RUNS), cases, metrics)
"""),
        md("## 요약"),
        code("""
summary = {}
for path in sorted(OUT.glob('*_metrics.json')):
    m = json.loads(path.read_text())
    summary[path.stem.replace('_metrics', '')] = {k: m[k] for k in ('format_valid', 'function', 'exact')}
(OUT / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2))
for name, v in summary.items():
    print(f'{name:24s} 형식 {v["format_valid"]:.4f} 기능 {v["function"]:.4f} 인자까지 {v["exact"]:.4f}')
print('비교 기준(같은 라벨): v2 단독 0.9500, v2c 0.9483, 세 run 다수결 0.9664')
"""),
    ]
    return {"cells": cells, "metadata": {"accelerator": "GPU", "colab": {"provenance": [], "gpuType": "A100"},
                                         "kernelspec": {"display_name": "Python 3", "name": "python3"},
                                         "language_info": {"name": "python"}},
            "nbformat": 4, "nbformat_minor": 5}


def main():
    data, counts = train.payload()
    sha = hashlib.sha256(data).hexdigest()
    assert (train.DATA / train.DATA_FILE).read_bytes() == data, "build_train_notebook.py를 먼저 돌리세요"
    out = HERE / "cropy_qwen_v2_merge_eval_colab.ipynb"
    out.write_text(json.dumps(notebook(sha, counts), ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(dict(data_sha256=sha, notebook=str(out), runs=RUNS, export=EXPORT)))


if __name__ == "__main__":
    main()
