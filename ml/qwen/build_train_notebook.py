"""Write the Colab LoRA training notebook for hs-call-v2 and its compressed data file.

Outputs
  data_v2/qwen_v2_data.jsonl.xz      train+validation rows with only the fields training needs
  cropy_qwen_v2_train_colab.ipynb    upload both to Drive MyDrive/cropy_qwen_v2/ and run on Colab GPU

The notebook embeds the system prompt and the function table, and checks the data hash, so a
notebook always runs against the exact data it was built with.
"""
import hashlib
import json
import lzma
from pathlib import Path

import spec_v2

HERE = Path(__file__).resolve().parent
DATA = HERE / "data_v2"
KEEP = ("case_id", "split", "group", "function", "user_text", "context", "output", "augmentation")
MODEL_ID = "Qwen/Qwen3.5-2B"
MODEL_REF = "15852e8c16360a2fea060d615a32b45270f8a8fc"  # revision used by the v14~v18 runs


def payload():
    rows = [json.loads(l) for split in ("train", "validation")
            for l in (DATA / f"{split}.jsonl").read_text(encoding="utf-8").splitlines()]
    for r in rows:
        assert spec_v2.compact_context(r["context"]) == r["context"]
        assert spec_v2.parse_call(r["output"]) == (r["function"], r["arguments"])
    text = "\n".join(json.dumps({k: r[k] for k in KEEP}, ensure_ascii=False, separators=(",", ":")) for r in rows)
    counts = {s: sum(r["split"] == s for r in rows) for s in ("train", "validation")}
    return lzma.compress(text.encode("utf-8"), preset=9 | lzma.PRESET_EXTREME), counts


def md(text):
    return {"cell_type": "markdown", "metadata": {}, "source": text.strip("\n").splitlines(keepends=True)}


def code(text):
    return {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [],
            "source": text.strip("\n").splitlines(keepends=True)}


def notebook(data_sha, counts):
    system = spec_v2.system_prompt()
    table = {name: [[arg, len(values)] for arg, values in args.items()] for name, args, _ in spec_v2.FUNCTIONS}
    cells = [
        md(f"""
# Cropy Qwen3.5 기능 선택 학습 (hs-call-v2)

발화와 화면 상태를 보고 `<hs_번호>(인자=값)<hs_end>` 한 줄을 출력하도록 `{MODEL_ID}`에 LoRA를 학습한다.

- 데이터: train {counts['train']:,}행 / validation {counts['validation']:,}행 (validation은 사람 검수 완료)
- 새 토큰 10개(`<hs_0>`~`<hs_8>`, `<hs_end>`)의 임베딩도 함께 학습한다.
- 런타임: **A100 권장**(L4·T4도 동작, 24GB 미만이면 4bit로 불러옴). 메뉴 런타임 → 런타임 유형 변경 → GPU.

**실행 방법**
1. Drive `내 드라이브/cropy_qwen_v2/`에 `qwen_v2_data.jsonl.xz`가 있는지 확인한다.
2. 위에서부터 차례로 실행한다(`런타임 → 모두 실행`).
3. 중간에 끊기면 새 런타임에서 그대로 다시 모두 실행한다. 같은 `RUN_NAME`이면 마지막 체크포인트(50step마다 저장)에서 이어서 학습한다.
4. 끝나면 `cropy_qwen_v2/<RUN_NAME>/` 안의 `eval_metrics.json`을 확인한다.
"""),
        code(f"""
from google.colab import drive
drive.mount('/content/drive')
from pathlib import Path
import json, hashlib, lzma, re, sys, subprocess, random, math, datetime

DRIVE_DIR = Path('/content/drive/MyDrive/cropy_qwen_v2')
DATA_FILE = DRIVE_DIR / 'qwen_v2_data.jsonl.xz'
DATA_SHA256 = '{data_sha}'
MODEL_ID = '{MODEL_ID}'
MODEL_REF = '{MODEL_REF}'

RUN_NAME = 'v2_r16_e2'      # 설정을 바꿔 새로 학습할 때만 이름을 바꾼다
EPOCHS = 2
LEARNING_RATE = 2e-4
LORA_R, LORA_ALPHA, LORA_DROPOUT = 16, 32, 0.05
EFFECTIVE_BATCH = 16
WARMUP_SHARE = 0.03
MAX_LENGTH = 2048
SEED = 20261027
EVAL_LIMIT = None            # None이면 validation 전체
OUTPUT_DIR = DRIVE_DIR / RUN_NAME
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
print('결과 폴더', OUTPUT_DIR)
"""),
        code("""
subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-q', 'transformers==5.19.0', 'peft==0.21.2',
                       'accelerate==1.15.0', 'bitsandbytes==0.50.2', 'tokenizers==0.23.2'])
import torch, transformers, peft
assert torch.cuda.is_available(), 'GPU 런타임을 선택하세요'
random.seed(SEED); torch.manual_seed(SEED); torch.cuda.manual_seed_all(SEED)
GPU = torch.cuda.get_device_name(0)
VRAM = torch.cuda.get_device_properties(0).total_memory
DTYPE = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
QUANTIZE = VRAM < 30 * 1024**3
PER_DEVICE = 8 if VRAM >= 39 * 1024**3 else 4 if VRAM >= 22 * 1024**3 else 2
ACCUM = max(1, EFFECTIVE_BATCH // PER_DEVICE)
ENV = dict(torch=torch.__version__, transformers=transformers.__version__, peft=peft.__version__, gpu=GPU,
           vram_gb=round(VRAM / 1024**3, 1), dtype=str(DTYPE), quantize_4bit=QUANTIZE, per_device=PER_DEVICE, accum=ACCUM)
print(ENV)
"""),
        md("## 데이터"),
        code(f"""
raw = DATA_FILE.read_bytes()
assert hashlib.sha256(raw).hexdigest() == DATA_SHA256, '데이터 파일이 노트북과 다릅니다. 같이 올린 qwen_v2_data.jsonl.xz를 쓰세요'
rows = [json.loads(l) for l in lzma.decompress(raw).decode('utf-8').splitlines()]
train_rows = [r for r in rows if r['split'] == 'train']
val_rows = [r for r in rows if r['split'] == 'validation']
assert (len(train_rows), len(val_rows)) == ({counts['train']}, {counts['validation']})

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

assert all(parse_call(r['output'])[0] == r['function'] for r in rows)
from collections import Counter
print('train', Counter(r['function'] for r in train_rows).most_common())
print('validation', Counter(r['function'] for r in val_rows).most_common())
"""),
        code("""
from transformers import AutoTokenizer
from collections.abc import Mapping
tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, revision=MODEL_REF)
BASE_EOS = tokenizer.eos_token_id
import inspect
if 'replace_extra_special_tokens' in inspect.signature(tokenizer.add_special_tokens).parameters:  # transformers 5
    tokenizer.add_special_tokens({'extra_special_tokens': NEW_TOKENS}, replace_extra_special_tokens=False)
else:
    tokenizer.add_special_tokens({'additional_special_tokens': NEW_TOKENS}, replace_additional_special_tokens=False)
TOKEN_IDS = {t: tokenizer.encode(t, add_special_tokens=False) for t in NEW_TOKENS}
assert all(len(v) == 1 for v in TOKEN_IDS.values()), TOKEN_IDS
TOKEN_IDS = {t: v[0] for t, v in TOKEN_IDS.items()}
END_ID = TOKEN_IDS['<hs_end>']
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

def encode(r):
    prefix, target = prompt_ids(r), tokenizer.encode(r['output'], add_special_tokens=False)
    assert target[0] in TOKEN_IDS.values() and target[-1] == END_ID
    assert len(prefix) + len(target) <= MAX_LENGTH, 'MAX_LENGTH를 늘리세요'
    return {'input_ids': prefix + target, 'attention_mask': [1] * (len(prefix) + len(target)),
            'labels': [-100] * len(prefix) + target}

train_encoded = [encode(r) for r in train_rows]
lengths = [len(x['input_ids']) for x in train_encoded]
print('토큰 길이 평균', sum(lengths) // len(lengths), '최대', max(lengths))
print('예시 정답 토큰', tokenizer.convert_ids_to_tokens([t for t in train_encoded[0]['labels'] if t != -100]))
"""),
        md("## 모델"),
        code("""
from transformers import BitsAndBytesConfig
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training, PeftModel
MODEL_CLASS = getattr(transformers, 'Qwen3_5ForConditionalGeneration')

def load_base():
    kwargs = dict(revision=MODEL_REF, device_map={'': 0}, dtype=DTYPE, attn_implementation='sdpa')
    if QUANTIZE:
        kwargs['quantization_config'] = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type='nf4',
                                                           bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=DTYPE)
    m = MODEL_CLASS.from_pretrained(MODEL_ID, **kwargs)
    m.resize_token_embeddings(max(len(tokenizer), m.get_input_embeddings().num_embeddings))
    return m

base = load_base()
if QUANTIZE:
    base = prepare_model_for_kbit_training(base, use_gradient_checkpointing=True,
                                           gradient_checkpointing_kwargs={'use_reentrant': False})
else:
    base.gradient_checkpointing_enable(gradient_checkpointing_kwargs={'use_reentrant': False})
    base.enable_input_require_grads()
EMBED = next(n for n, mod in base.named_modules() if mod is base.get_input_embeddings())
TEXT_ROOT = EMBED.rsplit('.', 1)[0]
# Every linear layer of the text decoder (attention, linear attention, MLP); vision tower and lm_head stay frozen.
TARGETS = sorted({n.rsplit('.', 1)[-1] for n, mod in base.named_modules()
                  if n.startswith(TEXT_ROOT + '.layers.') and isinstance(mod, torch.nn.Linear)})
config = LoraConfig(task_type='CAUSAL_LM', r=LORA_R, lora_alpha=LORA_ALPHA, lora_dropout=LORA_DROPOUT,
                    target_modules=re.escape(TEXT_ROOT) + r'\\.layers\\.\\d+\\..*\\.(?:' + '|'.join(TARGETS) + ')',
                    trainable_token_indices={EMBED: list(TOKEN_IDS.values())}, ensure_weight_tying=True)
model = get_peft_model(base, config)
model.config.use_cache = False
model.print_trainable_parameters()
print('LoRA 대상', TARGETS)
"""),
        md("## 학습\n50step마다 Drive에 저장한다. 끊기면 새 런타임에서 모두 실행하면 이어서 학습한다."),
        code("""
from transformers import Trainer, TrainingArguments
from transformers.trainer_utils import get_last_checkpoint
RUN_CONFIG = dict(data_sha256=DATA_SHA256, model_id=MODEL_ID, revision=MODEL_REF, epochs=EPOCHS, lr=LEARNING_RATE,
                  lora_r=LORA_R, lora_alpha=LORA_ALPHA, lora_dropout=LORA_DROPOUT, effective_batch=EFFECTIVE_BATCH,
                  targets=TARGETS, seed=SEED, new_tokens=TOKEN_IDS)
config_file = OUTPUT_DIR / 'run_config.json'
if config_file.exists():
    saved = json.loads(config_file.read_text())
    changed = [k for k in RUN_CONFIG if saved.get(k) != RUN_CONFIG[k]]
    assert not changed, f'같은 RUN_NAME에 다른 설정입니다: {changed}. RUN_NAME을 바꾸세요'
else:
    config_file.write_text(json.dumps(RUN_CONFIG, ensure_ascii=False, indent=2))

class Rows(torch.utils.data.Dataset):
    def __init__(self, rows): self.rows = rows
    def __len__(self): return len(self.rows)
    def __getitem__(self, i): return self.rows[i]

def collate(batch):
    n = max(len(x['input_ids']) for x in batch)
    pad = {'input_ids': tokenizer.pad_token_id, 'attention_mask': 0, 'labels': -100}
    return {k: torch.tensor([x[k] + [pad[k]] * (n - len(x[k])) for x in batch]) for k in pad}

steps = math.ceil(len(train_encoded) / (PER_DEVICE * ACCUM)) * EPOCHS
args = TrainingArguments(output_dir=str(OUTPUT_DIR / 'trainer'), num_train_epochs=EPOCHS, learning_rate=LEARNING_RATE,
                         lr_scheduler_type='cosine', warmup_steps=max(1, round(WARMUP_SHARE * steps)),
                         per_device_train_batch_size=PER_DEVICE, gradient_accumulation_steps=ACCUM,
                         bf16=DTYPE == torch.bfloat16, fp16=DTYPE == torch.float16,
                         gradient_checkpointing=True, gradient_checkpointing_kwargs={'use_reentrant': False},
                         logging_steps=10, save_strategy='steps', save_steps=50, save_total_limit=2,
                         report_to='none', seed=SEED, remove_unused_columns=False, optim='adamw_torch')
trainer = Trainer(model=model, args=args, train_dataset=Rows(train_encoded), data_collator=collate)
last = get_last_checkpoint(args.output_dir) if Path(args.output_dir).is_dir() else None
print('총', steps, 'step', '| 이어서 학습:', last)
result = trainer.train(resume_from_checkpoint=last)
(OUTPUT_DIR / 'train_log.json').write_text(json.dumps(trainer.state.log_history, indent=2))
(OUTPUT_DIR / 'train_metrics.json').write_text(json.dumps({**result.metrics, 'env': ENV}, indent=2))
ADAPTER_DIR = OUTPUT_DIR / 'adapter'
model.save_pretrained(ADAPTER_DIR, safe_serialization=True)
tokenizer.save_pretrained(ADAPTER_DIR)
print('어댑터 저장', ADAPTER_DIR)
"""),
        md("## 평가\nvalidation 전체를 greedy로 생성해 형식·기능·인자 정확도를 잰다. 첫 32건은 한 건씩 생성한 결과와 같아야 묶음 생성을 쓴다."),
        code("""
def generate(m, rows, batch_size):
    m.eval(); out = []
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

def score(rows, texts):
    cases = []
    for r, t in zip(rows, texts):
        got, gold = parse_call(t), parse_call(r['output'])
        cases.append(dict(case_id=r['case_id'], augmentation=r['augmentation'], user_text=r['user_text'],
                          expected=r['output'], actual=t, expected_function=r['function'],
                          actual_function=got[0] if got else None,
                          format_valid=got is not None, function_correct=bool(got) and got[0] == gold[0],
                          exact_correct=t == r['output']))
    def rate(cs, key):
        return round(sum(c[key] for c in cs) / max(1, len(cs)), 4)
    groups = lambda key: {v: dict(support=len(cs), function=rate(cs, 'function_correct'), exact=rate(cs, 'exact_correct'))
                          for v in sorted({c[key] for c in cases}) for cs in [[c for c in cases if c[key] == v]]}
    confusion = Counter(f"{c['expected_function']} -> {c['actual_function']}" for c in cases if not c['function_correct'])
    return cases, dict(support=len(cases), format_valid=rate(cases, 'format_valid'), function=rate(cases, 'function_correct'),
                       exact=rate(cases, 'exact_correct'), per_function=groups('expected_function'),
                       per_augmentation=groups('augmentation'), confusion=confusion.most_common(15))

model.config.use_cache = True
eval_rows = val_rows if EVAL_LIMIT is None else val_rows[:EVAL_LIMIT]
probe = eval_rows[:32]
BATCH = 16 if generate(model, probe, 1) == generate(model, probe, 16) else 1
print('묶음 생성 크기', BATCH)
val_texts = generate(model, eval_rows, BATCH)
val_cases, val_metrics = score(eval_rows, val_texts)
train_probe = random.Random(SEED).sample(train_rows, 300)
_, train_metrics = score(train_probe, generate(model, train_probe, BATCH))
metrics = dict(validation=val_metrics, train_sample_300=dict((k, train_metrics[k]) for k in ('format_valid', 'function', 'exact')),
               run=RUN_CONFIG | {'env': ENV, 'batch_generation': BATCH})
(OUTPUT_DIR / 'eval_metrics.json').write_text(json.dumps(metrics, ensure_ascii=False, indent=2))
with (OUTPUT_DIR / 'eval_cases.jsonl').open('w', encoding='utf-8') as f:
    for c in val_cases:
        f.write(json.dumps(c, ensure_ascii=False) + '\\n')
print(json.dumps({k: val_metrics[k] for k in ('support', 'format_valid', 'function', 'exact')}, ensure_ascii=False))
print('train 300', metrics['train_sample_300'])
for name, v in val_metrics['per_function'].items():
    print(f'{name:28s} n={v["support"]:4d} 기능 {v["function"]:.3f} 정확 {v["exact"]:.3f}')
print('자주 틀린 쌍', val_metrics['confusion'][:8])
"""),
        md("## 저장한 어댑터 다시 불러오기 확인"),
        code("""
import gc
del trainer, model, base; gc.collect(); torch.cuda.empty_cache()
reload_tok = AutoTokenizer.from_pretrained(ADAPTER_DIR)
assert all(reload_tok.encode(t, add_special_tokens=False) == [i] for t, i in TOKEN_IDS.items())
reloaded = PeftModel.from_pretrained(load_base(), ADAPTER_DIR, is_trainable=False)
check = eval_rows[:64]
same = generate(reloaded, check, BATCH) == val_texts[:64]
(OUTPUT_DIR / 'reload_check.json').write_text(json.dumps({'cases': len(check), 'outputs_equal': same}))
print('다시 불러온 결과가 같은가:', same)
print('완료. 결과 폴더:', OUTPUT_DIR)
"""),
    ]
    return {"cells": cells, "metadata": {"accelerator": "GPU", "colab": {"provenance": [], "gpuType": "A100"},
                                         "kernelspec": {"display_name": "Python 3", "name": "python3"},
                                         "language_info": {"name": "python"}},
            "nbformat": 4, "nbformat_minor": 5}


def main():
    data, counts = payload()
    (DATA / "qwen_v2_data.jsonl.xz").write_bytes(data)
    sha = hashlib.sha256(data).hexdigest()
    nb = notebook(sha, counts)
    out = HERE / "cropy_qwen_v2_train_colab.ipynb"
    out.write_text(json.dumps(nb, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(dict(data_bytes=len(data), data_sha256=sha, notebook=str(out), **counts)))


if __name__ == "__main__":
    main()
