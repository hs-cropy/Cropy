"""Write the Colab notebook that merges trained adapters without further training.

Output
  cropy_qwen_v2_merge_eval_colab.ipynb   upload to Drive MyDrive/cropy_qwen_v2/ and run on Colab GPU

What the notebook does (validation = qwen_v2c_data.jsonl.xz, the labels every run is compared on)
  1. merge  the chosen adapter (v2_r16_e2) into the base model, check it answers like the adapter, and save
            it as a plain Hugging Face model for the RKLLM conversion on the board
  2. soup   average the merged weights of the three long-prompt runs (v2, v2b, v2c) into one model and
            evaluate it; a 3-run majority vote reached 96.6% exact against 95.0% for v2 alone

2026-11-02 run: merged v2 95.1% (1,158/1,160 same as the adapter), soup 96.9% with batched generation.
The second build skips the merge, evaluates the soup one prompt at a time and saves it for the board.
"""
import hashlib
import json
from pathlib import Path

import build_train_notebook as train
import spec_v2

HERE = Path(__file__).resolve().parent
SMALL = train.BASE != "2b"  # QWEN_BASE=0.8b: soup of the three 0.8B seeds (browser / phone candidate)
if SMALL:
    # same data v2c, bf16 LoRA on A100, seeds 20261027 / 20261106 / 20261107: exact 90.26% / 91.12% / 89.40% (2026-11-06)
    RUNS = ["v2c_08b_a100_r16_e2", "v2c_08b_r16_e2_s20261106", "v2c_08b_r16_e2_s20261107"]
    EXPORT = RUNS[0]  # only the tokenizer is read from it; no single-adapter merge
    SOUP_NAME = "soup_08b_3seed"
    OUT_DIR = "merge_eval_08b"
    BASELINE = "비교 기준(같은 라벨): 0.8B 단일 seed 0.9026 / 0.9112 / 0.8940 (평균 0.9026), 2B 평균 모델 0.9690"
else:
    # 2026-11-03: RUNS v2_r16_e2 / v2b_r16_e2 / v2c_r16_e2 -> soup_v2_v2b_v2c (deployed, 0.9698 one prompt at a time).
    # 2026-11-11: v2d / v2e = v2c + real-speech patch, three seeds each. Their 3-seed soups lost validation
    # (95.4 / 94.4), so neither replaced the deployed model. Soup of the 3 deployed runs + the 3 v2d seeds kept
    # validation (0.9707 one prompt at a time) and raised real speech 71.5% -> 78.5%: deployed since 2026-11-11.
    # Earlier configs: v2d  RUNS v2d_r16_e2(_s20261111/_s20261112) -> soup_v2d_3seed, merge_eval_v2d
    #                  v2e  RUNS v2e_r16_e2(_s20261111/_s20261112) -> soup_v2e_3seed, merge_eval_v2e
    RUNS = ["v2_r16_e2", "v2b_r16_e2", "v2c_r16_e2", "v2d_r16_e2", "v2d_r16_e2_s20261111", "v2d_r16_e2_s20261112"]
    EXPORT = RUNS[0]  # only the tokenizer is read from it; no single-adapter merge
    SOUP_NAME = "soup_v2abc_v2d_6run"
    OUT_DIR = "merge_eval_soup6"
    BASELINE = ("비교 기준: 이전 배포 평균 모델(soup_v2_v2b_v2c) validation 0.9698(한 건씩). "
                "실제 발화는 위 deployed_real_speech 줄과 비교한다. 둘 다 나빠지지 않을 때만 교체한다")
DEPLOYED = "soup_v2_v2b_v2c"  # the model the 2026-11-10 testers talked to; comparison baseline for real speech
RUN_MERGE = False  # done on 2026-11-02 (v2_r16_e2/merged_hf)
SAVE_SOUP = True


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
2. **평균**: {', '.join(f'`{r}`' for r in RUNS)} {len(RUNS)}개 모델의 병합 가중치를 평균 낸 한 모델을 평가한다. {BASELINE}.

- 평가 기준: `{train.DATA_FILE}`의 validation {counts['validation']:,}행(학습 결과 비교에 써 온 라벨)
- 런타임: **A100**, 메뉴 런타임 → 모두 실행. 결과는 `cropy_qwen_v2/{OUT_DIR}/`, 병합 모델은 `cropy_qwen_v2/{EXPORT}/merged_hf/`, 평균 모델은 `cropy_qwen_v2/{SOUP_NAME}/merged_hf/`({'약 1.7GB' if SMALL else '각 약 4~5GB'}, Drive 여유 공간 확인).
- 이번 설정: 병합 {'실행' if RUN_MERGE else '건너뜀' + ('' if SMALL else '(11/2에 함)')}, 평균 모델 {'한 건씩 평가 후 저장' if SAVE_SOUP else '평가만'}.
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
RUN_MERGE = {RUN_MERGE}           # 단일 어댑터 병합·저장 (11/2에 함)
SAVE_MERGED = True          # False면 병합 모델을 Drive에 저장하지 않는다
SAVE_SOUP = {SAVE_SOUP}           # 평균 모델을 한 건씩 평가하고 Drive에 저장
SOUP_NAME = '{SOUP_NAME}'
OUT = DRIVE_DIR / '{OUT_DIR}'
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
real_rows = [r for r in rows if r['split'] == 'real_speech']   # 11/10 팀 테스트 발화(문장 부호 제거). 채점만 한다
assert (len(val_rows), len(real_rows)) == ({counts['validation']}, {counts.get('real_speech', 0)})

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
    # wrong answers only, as .json: small enough to read back from Drive without downloading the .jsonl
    wrong = [dict(id=c['case_id'], text=c['user_text'], expected=c['expected'], actual=c['actual'])
             for c in cases if c['exact_correct'] is False]
    (OUT / f'{name}_errors.json').write_text(json.dumps(wrong, ensure_ascii=False, indent=0))
    print(name, json.dumps({k: metrics[k] for k in ('format_valid', 'function', 'exact')}))

MODEL_CLASS = getattr(transformers, 'Qwen3_5ForConditionalGeneration')

def load_base():
    m = MODEL_CLASS.from_pretrained(MODEL_ID, revision=MODEL_REF, device_map={'': 0}, dtype=DTYPE, attn_implementation='sdpa')
    m.resize_token_embeddings(max(len(tokenizer), m.get_input_embeddings().num_embeddings))  # same as training
    return m

def load_merged(run):
    return PeftModel.from_pretrained(load_base(), DRIVE_DIR / run / 'adapter', is_trainable=False).merge_and_unload()

def save_hf(model, folder, source):
    # Plain HF model for the RKLLM conversion; a reload must answer the same.
    check = val_rows[:64]
    expected = generate(model, check, 1)
    folder.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(folder, safe_serialization=True, max_shard_size='2GB')
    tokenizer.save_pretrained(folder)
    (folder / 'cropy_prompt.json').write_text(json.dumps(
        dict(system_prompt=SYSTEM_PROMPT, functions=FUNCTIONS, new_tokens=TOKEN_IDS, user_format='{"utterance":...,"context":...}',
             enable_thinking=False, stop_token='<hs_end>', base=MODEL_ID, revision=MODEL_REF, source=source),
        ensure_ascii=False, indent=2))
    reloaded = MODEL_CLASS.from_pretrained(folder, device_map={'': 0}, dtype=DTYPE, attn_implementation='sdpa')
    ok = generate(reloaded, check, 1) == expected
    del reloaded; gc.collect(); torch.cuda.empty_cache()
    print('저장', folder, '| 다시 불러온 결과가 같은가:', ok)
    return {'cases': len(check), 'outputs_equal': ok}
"""),
        md(f"""
## 1. 병합 (`{EXPORT}`)
어댑터를 기본 가중치에 더해 일반 모델로 만든다. 어댑터로 평가했을 때 저장한 답(`{EXPORT}/eval_cases.jsonl`)과 얼마나 같은지 본다.
bf16에서 더하는 순서가 달라 몇 건은 달라질 수 있다.
"""),
        code("""
if RUN_MERGE:
    merged = load_merged(EXPORT)
    merged.config.use_cache = True
    texts, run_info = evaluate(merged)
    cases, metrics = score(texts)
    before = saved_outputs(EXPORT)
    same = sum(c['actual'] == before[c['case_id']] for c in cases)
    metrics |= dict(run=EXPORT, same_as_adapter=same, env=ENV, **run_info)
    write('merged_' + EXPORT, cases, metrics)
    print(f'어댑터 평가와 같은 답 {same}/{len(cases)}')
    if SAVE_MERGED:
        check = save_hf(merged, DRIVE_DIR / EXPORT / 'merged_hf', EXPORT)
        (OUT / 'merged_reload_check.json').write_text(json.dumps(check))
    del merged; gc.collect(); torch.cuda.empty_cache()
else:
    print('병합 건너뜀')
"""),
        md(f"""
## 2. 평균 (모델 수프)
{len(RUNS)}개 run을 각각 병합한 가중치를 평균 낸다(기본 가중치 + 변화량 평균과 같다). 새 토큰 임베딩도 평균 낸다.
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
if SAVE_SOUP:  # one prompt at a time, as the board will run it; the first run used batches of 16
    start = time.time()
    texts, run_info = generate(soup, val_rows, 1), dict(batch_generation=1)
    run_info['seconds'] = round(time.time() - start)
else:
    texts, run_info = evaluate(soup)
cases, metrics = score(texts)
metrics |= dict(runs=RUNS, env=ENV, **run_info)
name = SOUP_NAME + ('_b1' if run_info['batch_generation'] == 1 else '')
write(name, cases, metrics)
if SAVE_SOUP:
    (OUT / f'{name}_reload_check.json').write_text(json.dumps(save_hf(soup, DRIVE_DIR / SOUP_NAME / 'merged_hf', RUNS)))
"""),
        md(f"""
## 3. 실제 발화 평가
11/10 팀 테스트 발화를 새 평균 모델과 지금 배포 중인 모델(`{DEPLOYED}`)에 똑같이 넣는다. 학습에 쓰지 않은 문장이고,
두 모델 모두 문장 부호를 뺀 같은 입력을 받는다. 정답에 인자가 없는 행은 기능만 본다.
"""),
        code(f"""
def score_real(texts):
    cases = []
    for r, t in zip(real_rows, texts):
        got = parse_call(t)
        cases.append(dict(case_id=r['case_id'], input_kind=r['augmentation'], user_text=r['user_text'], expected=r['output'],
                          expected_function=r['function'], actual=t, actual_function=got[0] if got else None,
                          format_valid=got is not None, function_correct=bool(got) and got[0] == r['function'],
                          exact_correct=None if r['output'] is None else t == r['output']))
    full = [c for c in cases if c['exact_correct'] is not None]
    rate = lambda cs, key: round(sum(c[key] for c in cs) / max(1, len(cs)), 4)
    by = lambda key: {{v: dict(support=len(cs), function=rate(cs, 'function_correct'),
                               exact=rate([c for c in cs if c['exact_correct'] is not None], 'exact_correct'))
                       for v in sorted({{c[key] for c in cases}}) for cs in [[c for c in cases if c[key] == v]]}}
    return cases, dict(support=len(cases), exact_support=len(full), format_valid=rate(cases, 'format_valid'),
                       function=rate(cases, 'function_correct'), exact=rate(full, 'exact_correct'),
                       per_function=by('expected_function'), per_input_kind=by('input_kind'))

if real_rows:
    new_cases, new_metrics = score_real(generate(soup, real_rows, 1))
    write(SOUP_NAME + '_real_speech', new_cases, new_metrics | dict(runs=RUNS, env=ENV))
    del soup; gc.collect(); torch.cuda.empty_cache()
    deployed = MODEL_CLASS.from_pretrained(DRIVE_DIR / '{DEPLOYED}' / 'merged_hf', device_map={{'': 0}}, dtype=DTYPE, attn_implementation='sdpa')
    deployed.config.use_cache = True
    old_cases, old_metrics = score_real(generate(deployed, real_rows, 1))
    write('deployed_real_speech', old_cases, old_metrics | dict(model='{DEPLOYED}', env=ENV))
    del deployed; gc.collect(); torch.cuda.empty_cache()
    fixed = [n['case_id'] for n, o in zip(new_cases, old_cases) if n['function_correct'] and not o['function_correct']]
    broken = [n['case_id'] for n, o in zip(new_cases, old_cases) if o['function_correct'] and not n['function_correct']]
    (OUT / 'real_speech_changes.json').write_text(json.dumps(dict(fixed=fixed, broken=broken), ensure_ascii=False, indent=2))
    print(f'기능 기준: 고쳐진 발화 {{len(fixed)}}건, 새로 틀린 발화 {{len(broken)}}건')
    for name, v in new_metrics['per_function'].items():
        o = old_metrics['per_function'][name]
        print(f'{{name:28s}} n={{v["support"]:3d}} 기능 {{o["function"]:.3f}} -> {{v["function"]:.3f}} | 인자까지 {{o["exact"]:.3f}} -> {{v["exact"]:.3f}}')
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
"""),
        code(f"print({BASELINE!r})"),
    ]
    return {"cells": cells, "metadata": {"accelerator": "GPU", "colab": {"provenance": [], "gpuType": "A100"},
                                         "kernelspec": {"display_name": "Python 3", "name": "python3"},
                                         "language_info": {"name": "python"}},
            "nbformat": 4, "nbformat_minor": 5}


def main():
    data, counts = train.payload()
    sha = hashlib.sha256(data).hexdigest()
    assert (train.DATA / train.DATA_FILE).read_bytes() == data, "build_train_notebook.py를 먼저 돌리세요"
    out = HERE / ("cropy_qwen_v2_08b_merge_eval_colab.ipynb" if SMALL else "cropy_qwen_v2_merge_eval_colab.ipynb")
    out.write_text(json.dumps(notebook(sha, counts), ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(dict(data_sha256=sha, notebook=str(out), runs=RUNS, export=EXPORT)))


if __name__ == "__main__":
    main()
