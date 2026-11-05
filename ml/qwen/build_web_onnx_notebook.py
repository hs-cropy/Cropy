"""Write the Colab notebook that builds the browser (offline web, transformers.js WebGPU) Qwen bundle and scores it.

Output
  cropy_qwen_v2_web_onnx_colab.ipynb   upload to Drive MyDrive/cropy_qwen_v2/ with onnx_web/*.py in cropy_qwen_v2/web_onnx_scripts/

SIZE '2b'   the deployed soup model (soup_v2_v2b_v2c/merged_hf, float 97.0%)
SIZE '0.8b' the 0.8B run (v2c_08b_r16_e2, cropy_qwen_v2_08b_train_colab.ipynb); its adapter is merged here first
Steps: (0.8b) merge adapter -> onnx_web/export_web_onnx.py (official graphs + our weights, q4f16 and q4)
       -> onnx_web/eval_web_onnx.py on the same 300 validation rows as the RKLLM simulation.
Results: cropy_qwen_v2/web_onnx/<size>/ (bundle the web app downloads, export_report.json, web_*_metrics.json).
Checked locally on 2026-11-05 with the base 0.8B: all 694 weights matched the official ONNX, logits top-3 identical.
"""
import hashlib
import json
from pathlib import Path

import build_train_notebook as train

HERE = Path(__file__).resolve().parent
SCRIPTS = ["weights.py", "export_web_onnx.py", "eval_web_onnx.py"]
SIZES = {
    "2b": dict(model="soup_v2_v2b_v2c/merged_hf", adapter=None, ref="onnx-community/Qwen3.5-2B-ONNX-OPT",
               ref_rev="ed446636739bf426e73c5a00714fd8e010d36c21", base="Qwen/Qwen3.5-2B",
               base_rev="15852e8c16360a2fea060d615a32b45270f8a8fc", float_ref="merge_eval/soup_v2_v2b_v2c_b1_cases.jsonl"),
    "0.8b": dict(model="v2c_08b_r16_e2/merged_hf", adapter="v2c_08b_r16_e2/adapter", ref="onnx-community/Qwen3.5-0.8B-ONNX-OPT",
                 ref_rev="9a4c21d8f724176b0a7edaaed36303044451886e", base="Qwen/Qwen3.5-0.8B",
                 base_rev="2fc06364715b967f1860aea9cf38778875588b17", float_ref="v2c_08b_r16_e2/eval_cases.jsonl"),
}


def lf_sha(path):
    return hashlib.sha256(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def notebook(data_sha):
    md, code = train.md, train.code
    shas = {n: lf_sha(HERE / "onnx_web" / n) for n in SCRIPTS}
    cells = [
        md("""
# Cropy Qwen → 오프라인 웹(브라우저) 모델 만들기

오프라인 진단 화면(휴대폰 브라우저)에서 transformers.js + WebGPU로 돌릴 ONNX 묶음을 만들고 정확도를 잰다.

- 방법: Qwen3.5 공식 ONNX(onnx-community)의 그래프는 그대로 두고 **가중치만 우리 모델로 바꾼다**. 각 가중치가 기본 모델에서 어떻게 만들어졌는지는 공식 파일과 하나하나 대조해 확인한다(맞지 않으면 멈춘다).
- 형식: `q4f16`(WebGPU용, 기본)과 `q4`(fp16을 못 쓰는 GPU·CPU용).
- 평가: RKLLM 시뮬레이션과 같은 validation 300건, float 결과와 비교.
- `SIZE`: `'2b'`(지금 배포 모델) 또는 `'0.8b'`(0.8B 학습이 끝난 뒤). 둘 다 하려면 한 번 돌린 뒤 바꿔서 다시 모두 실행.
- 런타임: **A100 + 높은 RAM**. 결과는 `cropy_qwen_v2/web_onnx/<SIZE>/`.
"""),
        code(f"""
SIZE = '2b'          # '2b' 또는 '0.8b'
EVAL_DTYPES = ['q4f16', 'q4']
SIM_N = 300

from google.colab import drive
drive.mount('/content/drive')
from pathlib import Path
import hashlib, json, os, shutil, subprocess, sys
DRIVE_DIR = Path('/content/drive/MyDrive/cropy_qwen_v2')
DATA_FILE = DRIVE_DIR / '{train.DATA_FILE}'
DATA_SHA256 = '{data_sha}'
CFG = {SIZES!r}[SIZE]
OUT = DRIVE_DIR / 'web_onnx' / SIZE
WORK = Path('/content/web') / SIZE
for p in (OUT, WORK):
    p.mkdir(parents=True, exist_ok=True)
assert hashlib.sha256(DATA_FILE.read_bytes()).hexdigest() == DATA_SHA256, '데이터 파일이 노트북과 다릅니다'
print(SIZE, CFG)
"""),
        code(f"""
subprocess.run([sys.executable, '-m', 'pip', 'uninstall', '-y', '-q', 'torchao'])
subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-q', 'onnx==1.23.2', 'onnxruntime-gpu==1.31.1',
                       'transformers==5.19.0', 'peft==0.21.2', 'accelerate==1.15.0', 'tokenizers==0.23.2'])
SCRIPTS = DRIVE_DIR / 'web_onnx_scripts'
for name, sha in {shas!r}.items():
    data = (SCRIPTS / name).read_bytes().replace(bytes([13, 10]), bytes([10]))
    assert hashlib.sha256(data).hexdigest() == sha, f'{{name}}이 노트북과 다릅니다(다시 올리세요)'
    (Path('/content') / name).write_bytes(data)
import onnxruntime as ort
print('onnxruntime', ort.__version__, ort.get_available_providers())

def run(*argv):
    p = subprocess.Popen([sys.executable, '-u', *map(str, argv)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                         env=dict(os.environ, PYTHONUNBUFFERED='1', HF_HUB_DISABLE_PROGRESS_BARS='1'))
    for line in p.stdout:
        print(line, end='')
    assert p.wait() == 0, f'{{argv[0]}} 실패'
"""),
        md("## 0.8B만: 어댑터를 기본 모델에 합치기 (2B 평균 모델은 이미 합쳐져 있음)"),
        code("""
MODEL_DIR = DRIVE_DIR / CFG['model']
if not (MODEL_DIR / 'cropy_prompt.json').exists():
    assert CFG['adapter'], f'{MODEL_DIR}가 없습니다'
    import torch, transformers
    from transformers import AutoTokenizer
    from peft import PeftModel
    adapter = DRIVE_DIR / CFG['adapter']
    assert (adapter / 'adapter_config.json').exists(), '0.8B 학습(cropy_qwen_v2_08b_train_colab)이 아직 끝나지 않았습니다'
    tok = AutoTokenizer.from_pretrained(adapter)
    cls = getattr(transformers, 'Qwen3_5ForConditionalGeneration')
    base = cls.from_pretrained(CFG['base'], revision=CFG['base_rev'], dtype=torch.bfloat16, device_map={'': 0})
    base.resize_token_embeddings(max(len(tok), base.get_input_embeddings().num_embeddings))  # same as training
    merged = PeftModel.from_pretrained(base, adapter, is_trainable=False).merge_and_unload()
    local = WORK / 'merged_hf'
    merged.save_pretrained(local, safe_serialization=True, max_shard_size='2GB')
    tok.save_pretrained(local)
    prompt = json.loads((DRIVE_DIR / 'soup_v2_v2b_v2c/merged_hf/cropy_prompt.json').read_text(encoding='utf-8'))
    ids = {t: tok.convert_tokens_to_ids(t) for t in prompt['new_tokens']}
    assert ids == prompt['new_tokens'], ids  # same tokenizer, same new-token ids as the 2B model
    prompt.update(base=CFG['base'], revision=CFG['base_rev'], source=CFG['adapter'])
    (local / 'cropy_prompt.json').write_text(json.dumps(prompt, ensure_ascii=False, indent=2), encoding='utf-8')
    shutil.copytree(local, MODEL_DIR, dirs_exist_ok=True)
    del merged, base; torch.cuda.empty_cache()
    print('합친 모델 저장', MODEL_DIR)
else:
    print('합친 모델 있음', MODEL_DIR)
LOCAL_MODEL = WORK / 'merged_hf'
if not (LOCAL_MODEL / 'cropy_prompt.json').exists():
    shutil.copytree(MODEL_DIR, LOCAL_MODEL, dirs_exist_ok=True)
"""),
        md("## 1. 브라우저 묶음 만들기 (공식 그래프 + 우리 가중치)"),
        code("""
BUNDLE = WORK / 'bundle'
run('/content/export_web_onnx.py', '--ref-repo', CFG['ref'], '--ref-rev', CFG['ref_rev'], '--base-repo', CFG['base'],
    '--base-rev', CFG['base_rev'], '--model-dir', LOCAL_MODEL, '--out-dir', BUNDLE, '--dtypes', 'q4f16,q4')
shutil.copytree(BUNDLE, OUT / 'bundle', dirs_exist_ok=True)
report = json.loads((BUNDLE / 'export_report.json').read_text())
print({k: v for k, v in report.items() if k.startswith('download_mb')})
for g, info in report['graphs'].items():
    print(f"{g:36s} 가중치 {info['weights']:4d} 양자화 일치 최소 {info['quant_bytes']:.4f} {info['transforms']}")
"""),
        md("## 2. 정확도 (ONNX Runtime, 브라우저와 같은 그래프)"),
        code("""
for dt in EVAL_DTYPES:
    run('/content/eval_web_onnx.py', '--bundle', BUNDLE, '--data', DATA_FILE, '--data-sha', DATA_SHA256, '--dtype', dt,
        '--out-dir', WORK, '--sim-n', SIM_N, '--reference-cases', DRIVE_DIR / CFG['float_ref'], '--device', 'cuda')
    for name in (f'web_{dt}_metrics.json', f'web_{dt}_cases.jsonl'):
        shutil.copy(WORK / name, OUT / name)
"""),
        md("## 요약"),
        code("""
summary = dict(size=SIZE, download_mb={k: v for k, v in report.items() if k.startswith('download_mb')})
for dt in EVAL_DTYPES:
    m = json.loads((OUT / f'web_{dt}_metrics.json').read_text())
    summary[dt] = {k: m[k] for k in ('format_valid', 'function', 'exact', 'float_exact_same_rows', 'same_as_float', 'mean_prefill_s')}
    print(f"{dt:6s} 형식 {m['format_valid']:.4f} 기능 {m['function']:.4f} 인자까지 {m['exact']:.4f} | 같은 행 float {m['float_exact_same_rows']}"
          f" | float와 같은 답 {m['same_as_float']} | prefill {m['mean_prefill_s']}초 ({m['providers'][0]})")
    for fn, v in m['per_function'].items():
        print(f'   {fn:28s} {v["support"]:3d}건 기능 {v["function"]:.3f} 인자까지 {v["exact"]:.3f}')
(OUT / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2))
print('비교: 2B float 같은 300건 0.9833, RKLLM W8A8 0.9800')
"""),
    ]
    return {"cells": cells, "metadata": {"accelerator": "GPU", "colab": {"provenance": [], "gpuType": "A100", "machine_shape": "hm"},
                                         "kernelspec": {"display_name": "Python 3", "name": "python3"},
                                         "language_info": {"name": "python"}},
            "nbformat": 4, "nbformat_minor": 5}


def main():
    sha = hashlib.sha256((train.DATA / train.DATA_FILE).read_bytes()).hexdigest()
    out = HERE / "cropy_qwen_v2_web_onnx_colab.ipynb"
    out.write_text(json.dumps(notebook(sha), ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")
    print(json.dumps(dict(notebook=str(out), scripts={n: lf_sha(HERE / "onnx_web" / n) for n in SCRIPTS})))


if __name__ == "__main__":
    main()
