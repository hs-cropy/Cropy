"""Write a Colab notebook to try the deployed Qwen model by hand.

Output
  cropy_qwen_v2_demo_colab.ipynb   upload to Drive MyDrive/cropy_qwen_v2/ and run on any Colab GPU

The notebook loads the merged model chosen for the board and server (README "병합과 평균 모델"), shows a small
form (utterance + app state preset, editable as JSON), prints the call and what it means, and logs each try
with a right/wrong mark to cropy_qwen_v2/demo_log.jsonl so the team can grow a real-utterance test set.
Prompt, tokens and stop token come from the model folder's cropy_prompt.json, the same file the server reads.
"""
import json
from pathlib import Path

import build_train_notebook as train
import spec_v2

HERE = Path(__file__).resolve().parent
MODEL_DIR = "soup_v2_v2b_v2c/merged_hf"


def meanings():
    return {name: dict(description=description,
                       args={arg: [meaning for _, meaning in values] for arg, values in args.items()})
            for name, args, description in spec_v2.FUNCTIONS}


def notebook():
    presets = json.loads((HERE / "eval_context_presets.json").read_text(encoding="utf-8"))
    md, code = train.md, train.code
    cells = [
        md(f"""
# Cropy Qwen 기능 선택 모델 직접 해 보기

보드·서버에 올릴 모델(`cropy_qwen_v2/{MODEL_DIR}`)에 발화와 앱 화면 상태를 넣고, 모델이 고른 기능을 바로 본다.

- 런타임: GPU면 아무거나(T4도 됨). 메뉴 런타임 → 모두 실행 → 맨 아래 입력 칸이 나오면 쓴다.
- 화면 상태는 예시에서 고르고, 필요하면 JSON을 직접 고친다(예: 병명, 작물 불일치, 농약 목록).
- **맞음/틀림**을 누르면 `cropy_qwen_v2/demo_log.jsonl`에 남는다. 틀린 문장은 실제 발화 평가 자료로 쓴다.
"""),
        code(f"""
from google.colab import drive
drive.mount('/content/drive')
from pathlib import Path
import json, re, sys, subprocess, time, datetime

DRIVE_DIR = Path('/content/drive/MyDrive/cropy_qwen_v2')
MODEL_DIR = DRIVE_DIR / '{MODEL_DIR}'
LOG_FILE = DRIVE_DIR / 'demo_log.jsonl'
assert (MODEL_DIR / 'cropy_prompt.json').exists(), f'{{MODEL_DIR}}가 없습니다. 병합·평균 노트북을 먼저 돌리세요'
subprocess.check_call([sys.executable, '-m', 'pip', 'uninstall', '-y', '-q', 'torchao'])
subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-q', 'transformers==5.19.0', 'accelerate==1.15.0',
                       'tokenizers==0.23.2'])
import torch, transformers
from transformers import AutoTokenizer
from collections.abc import Mapping

PROMPT = json.loads((MODEL_DIR / 'cropy_prompt.json').read_text(encoding='utf-8'))
SYSTEM_PROMPT, FUNCTIONS = PROMPT['system_prompt'], PROMPT['functions']
NAMES = list(FUNCTIONS)
MEANINGS = {json.dumps(meanings(), ensure_ascii=False)}
PRESETS = {json.dumps(presets, ensure_ascii=False)}
assert list(MEANINGS) == NAMES
CALL = re.compile(r'^<hs_(\\d+)>\\(((?:[a-z_]+=-?\\d+(?:, [a-z_]+=-?\\d+)*)?)\\)<hs_end>$')

DEVICE = 'cuda' if torch.cuda.is_available() else 'cpu'
DTYPE = (torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16) if DEVICE == 'cuda' else torch.float32
tokenizer = AutoTokenizer.from_pretrained(MODEL_DIR)
END_ID = tokenizer.convert_tokens_to_ids(PROMPT['stop_token'])
model = getattr(transformers, 'Qwen3_5ForConditionalGeneration').from_pretrained(
    MODEL_DIR, device_map={{'': 0}} if DEVICE == 'cuda' else None, dtype=DTYPE, attn_implementation='sdpa').eval()
print('불러옴', MODEL_DIR, DEVICE, DTYPE)
"""),
        code("""
def explain(text):
    m = CALL.match(text.strip())
    if not m or int(m.group(1)) >= len(NAMES):
        return '형식 오류: 서버가 해석할 수 없는 답'
    name = NAMES[int(m.group(1))]
    given = [p.split('=') for p in m.group(2).split(', ')] if m.group(2) else []
    if [k for k, _ in given] != [a for a, _ in FUNCTIONS[name]]:
        return f'형식 오류: {name}의 인자 이름이 다름'
    lines = [f'{name} — {MEANINGS[name]["description"]}']
    for k, v in given:
        values = MEANINGS[name]['args'][k]
        if not 1 <= int(v) <= len(values):
            return f'형식 오류: {name}.{k}={v}는 없는 번호'
        lines.append(f'  {k}={v}: {values[int(v) - 1]}')
    return '\\n'.join(lines)

def ask(utterance, context):
    user = json.dumps({'utterance': utterance, 'context': context}, ensure_ascii=False, separators=(',', ':'))
    ids = tokenizer.apply_chat_template([{'role': 'system', 'content': SYSTEM_PROMPT}, {'role': 'user', 'content': user}],
                                        tokenize=True, add_generation_prompt=True, enable_thinking=False)
    if isinstance(ids, Mapping):
        ids = ids['input_ids']
    ids = ids.tolist() if hasattr(ids, 'tolist') else list(ids)
    ids = ids[0] if ids and isinstance(ids[0], list) else ids
    start = time.time()
    with torch.no_grad():
        out = model.generate(input_ids=torch.tensor([ids], device=model.device), max_new_tokens=16, do_sample=False,
                             eos_token_id=[END_ID, tokenizer.eos_token_id], pad_token_id=tokenizer.pad_token_id or tokenizer.eos_token_id)
    seq = out[0, len(ids):].tolist()
    seq = seq[:seq.index(END_ID) + 1] if END_ID in seq else seq
    return tokenizer.decode(seq, skip_special_tokens=False).strip(), len(ids), time.time() - start

print(ask('안녕하세요', PRESETS['P01_no_photo']))
"""),
        md("## 입력 칸\n발화를 쓰고 **실행**. 답이 맞는지 보고 **맞음/틀림**을 누르면 기록된다(틀림이면 메모에 기대한 답을 적어 두면 좋다)."),
        code("""
import ipywidgets as w
from IPython.display import display

utter = w.Text(placeholder='예: 이거 무슨 병이야', description='발화', layout=w.Layout(width='95%'))
preset = w.Dropdown(options=list(PRESETS), value='P05_result_disease_one_product', description='화면 상태')
ctx = w.Textarea(value=json.dumps(PRESETS[preset.value], ensure_ascii=False, indent=1), description='context',
                 layout=w.Layout(width='95%', height='170px'))
note = w.Text(placeholder='틀렸을 때 기대한 답이나 메모', description='메모', layout=w.Layout(width='95%'))
run, good, bad = w.Button(description='실행', button_style='primary'), w.Button(description='맞음'), w.Button(description='틀림')
out = w.Output()
last = {}

def on_preset(change):
    ctx.value = json.dumps(PRESETS[change['new']], ensure_ascii=False, indent=1)

def on_run(_):
    out.clear_output()
    with out:
        try:
            context = json.loads(ctx.value)
        except json.JSONDecodeError as e:
            print('context JSON 오류:', e); return
        if not utter.value.strip():
            print('발화를 입력하세요'); return
        answer, n, sec = ask(utter.value.strip(), context)
        last.clear(); last.update(utterance=utter.value.strip(), preset=preset.value, context=context, output=answer)
        print(answer)
        print(explain(answer))
        print(f'(입력 {n}토큰, {sec:.2f}초, {model.device})')

def mark(ok):
    def handler(_):
        with out:
            if not last:
                print('먼저 실행하세요'); return
            row = dict(last, correct=ok, note=note.value.strip(), at=datetime.datetime.now().isoformat(timespec='seconds'))
            with LOG_FILE.open('a', encoding='utf-8') as f:
                f.write(json.dumps(row, ensure_ascii=False) + '\\n')
            print('기록함:', '맞음' if ok else '틀림', '→', LOG_FILE.name)
            last.clear(); note.value = ''
    return handler

preset.observe(on_preset, names='value')
run.on_click(on_run)
if hasattr(utter, 'on_submit'):  # Enter로 실행 (ipywidgets 7)
    utter.on_submit(on_run)
good.on_click(mark(True)); bad.on_click(mark(False))
display(w.VBox([utter, preset, ctx, w.HBox([run, good, bad]), note, out]))
"""),
        md("## 기록 보기"),
        code("""
if LOG_FILE.exists():
    rows = [json.loads(l) for l in LOG_FILE.read_text(encoding='utf-8').splitlines()]
    print(f'{len(rows)}건, 맞음 {sum(r["correct"] for r in rows)}건')
    for r in rows[-20:]:
        print('O' if r['correct'] else 'X', r['preset'], '|', r['utterance'], '→', r['output'], '|', r['note'])
else:
    print('아직 기록이 없습니다')
"""),
    ]
    return {"cells": cells, "metadata": {"accelerator": "GPU", "colab": {"provenance": [], "gpuType": "T4"},
                                         "kernelspec": {"display_name": "Python 3", "name": "python3"},
                                         "language_info": {"name": "python"}},
            "nbformat": 4, "nbformat_minor": 5}


def main():
    out = HERE / "cropy_qwen_v2_demo_colab.ipynb"
    out.write_text(json.dumps(notebook(), ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(dict(notebook=str(out), model=MODEL_DIR)))


if __name__ == "__main__":
    main()
