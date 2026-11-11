"""Write the Colab notebook that converts the deployed Qwen model to int8 RKLLM for the Orange Pi 5 (RK3588 NPU).

Output
  cropy_qwen_v2_rkllm_colab.ipynb   upload to Drive MyDrive/cropy_qwen_v2/ and run on a Colab A100 (high RAM)

What the notebook does (model = soup_v2abc_v2d_6run/merged_hf, validation rows = the same 1,160 as qwen_v2c)
  1. installs rkllm-toolkit (RKLLM_VERSION, Qwen3.5 supported since 1.3.0) in its own Python 3.11 venv,
     because it pins torch 2.6 / transformers 5.8 and auto_gptq has no 3.12 wheel
  2. rkllm/prepare_rkllm.py   token checks, calibration set from train, prompts+ids for every validation row,
                              float check under the toolkit's transformers version
  3. rkllm/convert_rkllm.py   W8A8 build + export, then PC simulation of the quantized model on a validation subset
Results go to cropy_qwen_v2/rkllm/ (the .rkllm file, eval_cases.jsonl for the board, metrics).
The two scripts are uploaded next to it (cropy_qwen_v2/rkllm_scripts/, sha-checked); they also run as-is on a Linux PC.
"""
import hashlib
import json
from pathlib import Path

import build_train_notebook as train

HERE = Path(__file__).resolve().parent
CRLF, LF = bytes([13, 10]), bytes([10])
MODEL_DIR = "soup_v2abc_v2d_6run/merged_hf"  # deployed since 2026-11-11 (before: soup_v2_v2b_v2c)
REFERENCE = "merge_eval_soup6/soup_v2abc_v2d_6run_b1_cases.jsonl"  # float outputs of the same model, one prompt at a time
RKLLM_VERSION = "1.3.1"
QUANTS = ["w8a8"]  # add "w8a8_g128" etc. if plain w8a8 loses accuracy
SIM_N = 300


def notebook(data_sha):
    md, code = train.md, train.code
    shas = {n: hashlib.sha256((HERE / "rkllm" / n).read_bytes().replace(CRLF, LF)).hexdigest()
            for n in ("prepare_rkllm.py", "convert_rkllm.py")}
    cells = [
        md(f"""
# Cropy Qwen → RKLLM int8 변환 (오렌지파이5 RK3588 NPU)

보드·서버용 평균 모델(`cropy_qwen_v2/{MODEL_DIR}`)을 RKLLM **W8A8** 모델로 바꾸고, 보드 없이 PC(Colab)에서 양자화 모델을 돌려 정확도를 먼저 본다.

1. rkllm-toolkit {RKLLM_VERSION}을 별도 Python 3.11 환경에 설치한다(torch 2.6·transformers 5.8 고정이라 Colab 기본 환경과 분리).
2. **준비**: 새 토큰 10개 확인, 학습 데이터에서 보정(calibration) 입력 64개, validation 전체의 프롬프트·토큰 저장, 툴킷 transformers 버전으로 float 모델 확인.
3. **변환**: W8A8 양자화 → `.rkllm` 저장 → validation {SIM_N}건을 양자화 모델로 시뮬레이션해 float 결과(97.0%)와 비교.

- 런타임: **A100 + 높은 RAM** (L4·T4도 됨). 툴킷의 torch 2.6은 최신 GPU(G4·RTX PRO 6000·B200 등 Blackwell)를 지원하지 않는다. 메뉴 런타임 → 모두 실행. 변환은 수십 분 걸릴 수 있다.
- 결과: `cropy_qwen_v2/rkllm/` — `cropy_qwen_w8a8_rk3588.rkllm`(보드에 복사), `eval_cases.jsonl`(보드 평가 입력), `sim_w8a8_metrics.json`.
- 끊기면 다시 모두 실행: 시뮬레이션은 이미 한 건을 건너뛰지만 변환은 처음부터 다시 한다.
- 보드에서 돌릴 때는 `skip_special_token = false`로 해야 `<hs_4>` 같은 토큰이 지워지지 않는다.
"""),
        code(f"""
from google.colab import drive
drive.mount('/content/drive')
from pathlib import Path
import hashlib, json, os, shutil, subprocess, sys

DRIVE_DIR = Path('/content/drive/MyDrive/cropy_qwen_v2')
MODEL_DIR = DRIVE_DIR / '{MODEL_DIR}'
DATA_FILE = DRIVE_DIR / '{train.DATA_FILE}'
DATA_SHA256 = '{data_sha}'
REFERENCE = DRIVE_DIR / '{REFERENCE}'
RKLLM_VERSION = '{RKLLM_VERSION}'
QUANTS = {QUANTS!r}      # 정확도가 떨어지면 'w8a8_g128' 등을 추가해 비교
SIM_N = {SIM_N}          # 양자화 모델 시뮬레이션 건수 (-1이면 validation 전체, 0이면 건너뜀)
ALLOW_CPU = False    # GPU가 툴킷 torch 2.6과 안 맞을 때 CPU로 진행(매우 느림). 기본은 멈추고 A100으로 바꾸라고 안내
OUT = DRIVE_DIR / 'rkllm'
WORK = Path('/content/rk')        # 변환 중간 파일은 로컬에서 만들고 결과만 Drive로 복사
for p in (OUT, WORK):
    p.mkdir(parents=True, exist_ok=True)
assert (MODEL_DIR / 'cropy_prompt.json').exists(), f'{{MODEL_DIR}}가 없습니다'
assert hashlib.sha256(DATA_FILE.read_bytes()).hexdigest() == DATA_SHA256, '데이터 파일이 노트북과 다릅니다'
print('참고 float 결과:', REFERENCE.exists())
# 모델을 로컬 디스크로 복사(Drive에서 직접 읽으면 느림)
LOCAL_MODEL = WORK / 'merged_hf'
if not (LOCAL_MODEL / 'cropy_prompt.json').exists():
    shutil.copytree(MODEL_DIR, LOCAL_MODEL, dirs_exist_ok=True)
print('모델', sum(f.stat().st_size for f in LOCAL_MODEL.iterdir()) / 2**30, 'GB')
subprocess.run(['nvidia-smi', '--query-gpu=name,memory.total', '--format=csv'])
"""),
        md("## 1. rkllm-toolkit 설치 (별도 Python 3.11 환경)"),
        code("""
VENV = Path('/content/rkenv')
PY = VENV / 'bin' / 'python'
if not PY.exists():
    if shutil.which('uv') is None:
        subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-q', 'uv'])
    subprocess.check_call(['uv', 'venv', str(VENV), '--python', '3.11'])
    wheel = WORK / f'rkllm_toolkit-{RKLLM_VERSION}-cp311-cp311-linux_x86_64.whl'
    url = f'https://github.com/airockchip/rknn-llm/raw/release-v{RKLLM_VERSION}/rkllm-toolkit/packages/{wheel.name}'
    subprocess.check_call(['curl', '-sSL', '-o', str(wheel), url])
    subprocess.check_call(['uv', 'pip', 'install', '--python', str(PY), str(wheel)])
print(subprocess.run([str(PY), '-c', 'import torch, transformers, rkllm.api; print("torch", torch.__version__, "cuda", torch.cuda.is_available(), "| transformers", transformers.__version__)'],
                     capture_output=True, text=True).stdout)
# The toolkit pins torch 2.6 (CUDA 12.4): A100·L4·T4·H100 work, newer GPUs (Blackwell: G4/RTX PRO 6000, B200) do not.
gpu = subprocess.run([str(PY), '-c', 'import torch; x = torch.ones(4, device="cuda"); print(float((x * 2).sum()), torch.cuda.get_device_name(0), torch.cuda.get_device_capability(0))'],
                     capture_output=True, text=True)
if gpu.returncode == 0:
    DEVICE = 'cuda'
    print('GPU 사용 가능:', gpu.stdout.strip())
elif ALLOW_CPU:
    DEVICE = 'cpu'
    print('이 GPU에서 torch 2.6이 돌지 않아 CPU로 진행합니다(느림, float 확인 생략).', gpu.stderr.strip().splitlines()[-1:])
else:
    subprocess.run(['nvidia-smi', '--query-gpu=name,compute_cap', '--format=csv'])
    raise SystemExit('이 GPU는 툴킷의 torch 2.6이 지원하지 않습니다. 런타임 → 런타임 유형 변경에서 A100(또는 L4·T4)을 고르고 '
                     '다시 모두 실행하세요. CPU로라도 돌리려면 첫 셀의 ALLOW_CPU = True.')

def run(script, *argv):
    # Stream the script's log here; stop the notebook if it fails.
    p = subprocess.Popen([str(PY), '-u', str(script), *map(str, argv)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         text=True, env=dict(os.environ, PYTHONUNBUFFERED='1'))
    for line in p.stdout:
        print(line, end='')
    assert p.wait() == 0, f'{script.name} 실패 (exit {p.returncode})'
"""),
        md("## 스크립트 (저장소 `ml/qwen/rkllm/`와 같음, Drive `cropy_qwen_v2/rkllm_scripts/`에서 복사)"),
        code(f"""
SCRIPTS = DRIVE_DIR / 'rkllm_scripts'
for name, sha in {shas!r}.items():
    data = (SCRIPTS / name).read_bytes().replace(bytes([13, 10]), bytes([10]))  # Drive 업로드가 줄바꿈을 바꿔도 같게
    assert hashlib.sha256(data).hexdigest() == sha, f'{{name}}이 노트북과 다릅니다(다시 올리세요)'
    (WORK / name).write_bytes(data)
print('스크립트 복사', WORK)
"""),
        md("## 2. 준비: 토큰 확인 · 보정 데이터 · 평가 입력 · float 확인"),
        code("""
run(WORK / 'prepare_rkllm.py', '--model-dir', LOCAL_MODEL, '--data', DATA_FILE, '--data-sha', DATA_SHA256,
    '--out-dir', WORK, '--reference-cases', REFERENCE, '--device', DEVICE)
for name in ('prepare_report.json', 'data_quant.json', 'eval_cases.jsonl'):
    shutil.copy(WORK / name, OUT / name)
report = json.loads((WORK / 'prepare_report.json').read_text())
print(json.dumps({k: report[k] for k in ('transformers', 'prompt_tokens', 'float_check')}, ensure_ascii=False))
fc = report['float_check']
if fc and fc['same_as_colab'] is not None and fc['same_as_colab'] < fc['n'] - 2:
    print('주의: 툴킷 transformers로 불러온 float 모델이 Colab 결과와 많이 다릅니다. 변환 결과도 믿기 어렵습니다.')
"""),
        md("## 3. 변환 + PC 시뮬레이션"),
        code("""
for quant in QUANTS:
    # Simulation rows already on Drive are copied back so a rerun resumes them.
    sim = OUT / f'sim_{quant}_cases.jsonl'
    if sim.exists():
        shutil.copy(sim, WORK / sim.name)
    run(WORK / 'convert_rkllm.py', '--model-dir', LOCAL_MODEL, '--work-dir', WORK, '--quant', quant,
        '--sim-n', SIM_N, '--reference-cases', REFERENCE, '--device', DEVICE)
    for f in WORK.glob(f'*{quant}*'):
        shutil.copy(f, OUT / f.name)
        print('Drive에 저장', f.name, f'{f.stat().st_size / 2**20:.1f}MB')
"""),
        md("## 요약"),
        code("""
summary = dict(prepare={k: report[k] for k in ('transformers', 'new_tokens', 'prompt_tokens', 'float_check')})
for path in sorted(OUT.glob('sim_*_metrics.json')):
    m = json.loads(path.read_text())
    summary[m['quant']] = {k: m[k] for k in ('rkllm_gb', 'support', 'format_valid', 'function', 'exact',
                                             'float_exact_same_rows', 'same_as_float')}
    print(f"{m['quant']:10s} {m['rkllm_gb']}GB | 형식 {m['format_valid']:.4f} 기능 {m['function']:.4f} 인자까지 {m['exact']:.4f}"
          f" | 같은 행 float {m['float_exact_same_rows']} | float와 같은 답 {m['same_as_float']}")
    for fn, v in m['per_function'].items():
        print(f'   {fn:32s} {v["support"]:4d}건 기능 {v["function"]:.3f} 인자까지 {v["exact"]:.3f}')
(OUT / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2))
print('비교 기준: float 평균 모델 validation 전체 0.9700 (한 건씩)')
"""),
    ]
    return {"cells": cells, "metadata": {"accelerator": "GPU", "colab": {"provenance": [], "gpuType": "A100", "machine_shape": "hm"},
                                         "kernelspec": {"display_name": "Python 3", "name": "python3"},
                                         "language_info": {"name": "python"}},
            "nbformat": 4, "nbformat_minor": 5}


def main():
    data = (train.DATA / train.DATA_FILE).read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    out = HERE / "cropy_qwen_v2_rkllm_colab.ipynb"
    out.write_text(json.dumps(notebook(sha), ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(dict(data_sha256=sha, notebook=str(out), model=MODEL_DIR, rkllm=RKLLM_VERSION, quants=QUANTS)))


if __name__ == "__main__":
    main()
