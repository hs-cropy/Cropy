"""Package original bytes from the audited split, without existing model weights."""
import csv
import hashlib
import io
import json
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/colab/group_baseline_20260921'


def main():
    OUT.mkdir(exist_ok=True)
    source = ROOT / 'output/colab/group_split_candidates_20260921/worker_unique_candidate.csv'
    rows = list(csv.DictReader(source.open(encoding='utf-8-sig')))
    seen = set()
    workers = defaultdict(set)
    groups = defaultdict(set)
    for r in rows:
        assert r['sha256'] not in seen
        seen.add(r['sha256'])
        workers[r['filename_worker']].add(r['candidate_split'])
        groups[r['group_id']].add(r['candidate_split'])
        r['bundle_path'] = f"dataset/{r['candidate_split']}/{r['class']}/{Path(r['path']).name}"
    assert len({r['bundle_path'] for r in rows}) == len(rows) == 4235
    assert all(len(s) == 1 for s in workers.values())
    assert all(len(s) == 1 for s in groups.values())
    assert Counter(r['candidate_split'] for r in rows) == dict(train=2728, val=785, test=722)
    stream = io.StringIO(newline='')
    writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
    writer.writeheader()
    writer.writerows(rows)
    manifest = stream.getvalue().encode('utf-8-sig')
    (OUT / 'manifest.csv').write_bytes(manifest)
    bundle = OUT / 'cropy_group_baseline_bundle.zip'
    with zipfile.ZipFile(bundle, 'x', compression=zipfile.ZIP_STORED, allowZip64=True) as z:
        z.writestr('manifest.csv', manifest)
        for script in ('train.py', 'train_group_baseline.py'):
            z.write(ROOT / 'ml' / script, script)
        for i, r in enumerate(rows, 1):
            path = ROOT / r['path']
            with path.open('rb') as f:
                assert hashlib.file_digest(f, 'sha256').hexdigest() == r['sha256'], path
            z.write(path, r['bundle_path'])
            if i % 500 == 0:
                print('packed', i, flush=True)
    # Read every archived image back and verify bytes, rather than trusting ZIP creation.
    with zipfile.ZipFile(bundle) as z:
        assert len(z.namelist()) == len(rows) + 3
        assert not any(n.endswith('.pth') for n in z.namelist())
        for r in rows:
            with z.open(r['bundle_path']) as f:
                assert hashlib.file_digest(f, 'sha256').hexdigest() == r['sha256']
    with bundle.open('rb') as f:
        digest = hashlib.file_digest(f, 'sha256').hexdigest()
    summary = dict(images=len(rows), counts=dict(Counter(r['candidate_split'] for r in rows)),
                   bundle_bytes=bundle.stat().st_size, bundle_sha256=digest,
                   manifest_sha256=hashlib.sha256(manifest).hexdigest(),
                   image_bytes_verified=4235, worker_crossovers=0, hash_duplicates=0,
                   training_completed=False)
    (OUT / 'bundle_info.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    make_notebook(digest)
    print(json.dumps(summary), flush=True)


def make_notebook(digest):
    cells = []
    def md(s):
        cells.append(dict(cell_type='markdown', metadata={}, source=s.splitlines(True)))
    def code(s):
        cells.append(dict(cell_type='code', metadata={}, source=s.splitlines(True), outputs=[], execution_count=None))
    md('# cropy — 작업자 분리 CNN 기준선\n'
       '원본 4,235장: train 2,728 / val 785 / test 722. ResNet50, 224, ImageNet V2 초기화.\n'
       '기존 cropy 가중치는 사용하지 않습니다. 기존 val 96.23%와 직접 비교하지 마세요.\n'
       '무노균병 작업자는 train 3명 / val 1명 / test 1명이며 개체·농장 독립성은 확인되지 않았습니다.\n\n'
       'Colab 런타임을 GPU(T4 등)로 선택하세요. 약 7.75GB ZIP을 Google Drive의 MyDrive/cropy 폴더에 먼저 업로드하세요. '
       '압축 해제에 로컬 디스크 약 8GB가 필요하며 학습 결과는 Drive에 저장됩니다.\n'
       '1~4번을 순서대로 실행합니다. 5번 test는 모델 선택 확정 전 실행하지 않습니다.')
    md('## 1. Drive 연결 및 원본 번들 검증·압축 해제')
    code('''from google.colab import drive
drive.mount('/content/drive')
from pathlib import Path
from datetime import datetime, timezone
import csv, hashlib, json, shutil, subprocess, sys, zipfile
from collections import Counter, defaultdict
import torch
assert torch.cuda.is_available(), '런타임 > 런타임 유형 변경 > GPU 선택'
BUNDLE = Path('/content/drive/MyDrive/cropy/cropy_group_baseline_bundle.zip')
assert BUNDLE.is_file(), f'업로드 경로 확인: {BUNDLE}'
EXPECTED_SHA256 = ''' + repr(digest) + '''
with BUNDLE.open('rb') as f:
    assert hashlib.file_digest(f, 'sha256').hexdigest() == EXPECTED_SHA256, '번들 해시 불일치'
RUN_ID = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S_%f')
WORK = Path('/content') / ('cropy_group_' + RUN_ID)
WORK.mkdir(exist_ok=False)
with zipfile.ZipFile(BUNDLE) as z:
    assert shutil.disk_usage(WORK).free > sum(i.file_size for i in z.infolist()) + 2_000_000_000
    for name in z.namelist():
        assert (WORK / name).resolve().is_relative_to(WORK.resolve()), '안전하지 않은 경로'
    z.extractall(WORK)
with (WORK / 'manifest.csv').open(encoding='utf-8-sig') as f:
    rows = list(csv.DictReader(f))
workers, hashes = defaultdict(set), set()
for r in rows:
    with (WORK / r['bundle_path']).open('rb') as f:
        assert hashlib.file_digest(f, 'sha256').hexdigest() == r['sha256']
    assert r['sha256'] not in hashes
    hashes.add(r['sha256'])
    workers[r['filename_worker']].add(r['candidate_split'])
assert all(len(v) == 1 for v in workers.values())
assert Counter(r['candidate_split'] for r in rows) == dict(train=2728, val=785, test=722)
RESULTS = Path('/content/drive/MyDrive/cropy/results') / RUN_ID
print('검증 완료:', len(rows), Counter(r['candidate_split'] for r in rows))
print('GPU:', torch.cuda.get_device_name(0), '\\n결과 경로:', RESULTS)
''')
    md('## 2. ImageNet에서 새 기준선 학습\n20 epoch, 일반 샘플링, batch 32. 동일 결과 폴더에 재실행하면 중단합니다. '
       '메모리 부족 시 새 실행에서 BATCH_SIZE를 16으로 낮추고 변경 내용을 기록하세요. '
       '매 epoch 지표와 val 정확도 최고 모델을 저장합니다. 동률은 앞선 epoch를 유지합니다. '
       '런타임이 끊기면 저장된 best 모델은 보존되지만 자동 이어학습은 지원하지 않습니다.')
    code('''EPOCHS = 20
BATCH_SIZE = 32
command = [sys.executable, '-u', str(WORK / 'train_group_baseline.py'),
           '--data-dir', str(WORK / 'dataset'), '--output-dir', str(RESULTS),
           '--epochs', str(EPOCHS), '--batch-size', str(BATCH_SIZE), '--seed', '42']
with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True) as proc:
    for line in proc.stdout:
        print(line, end='')
    if proc.wait() != 0:
        raise RuntimeError('학습 실패. 위 오류를 확인하세요.')
shutil.copy2(WORK / 'manifest.csv', RESULTS / 'manifest.csv')
''')
    md('## 3. 검증 결과 확인\n클래스별 수치는 재현율입니다. test는 아직 평가하지 않습니다.')
    code('''import pandas as pd
import matplotlib.pyplot as plt
config = json.loads((RESULTS / 'config.json').read_text())
result = json.loads((RESULTS / 'val_metrics.json').read_text())
print('선택 epoch:', result['epoch'], 'val:', f"{result['accuracy']:.2%}", 'macro F1:', result['macro_f1'])
display(pd.DataFrame({'class': config['classes'], 'recall': result['recall'], 'count': result['support']}))
fig, ax = plt.subplots(figsize=(7, 6))
ax.imshow(result['confusion_matrix'], cmap='Greens')
for i, row in enumerate(result['confusion_matrix']):
    for j, count in enumerate(row):
        ax.text(j, i, str(count), ha='center', va='center')
ax.set(xlabel='Predicted class ID', ylabel='Actual class ID', title='Worker split / val', xticks=range(9), yticks=range(9))
fig.tight_layout()
fig.savefig(RESULTS / 'val_confusion.png')
plt.show()
plt.close(fig)
''')
    md('## 4. 결과 ZIP 내려받기\n이 ZIP을 로컬 프로젝트에 넣으면 다음 실험을 검토할 수 있습니다. 데이터 원본은 포함하지 않습니다.')
    code('''from google.colab import files
result_zip = shutil.make_archive(str(Path('/content') / ('cropy_group_results_' + RUN_ID)), 'zip', RESULTS)
shutil.copy2(result_zip, RESULTS.parent / Path(result_zip).name)
files.download(result_zip)
''')
    md('## 5. 최종 test 평가 — 기본 비활성화\n224/256 등 모델 선택과 설정을 val로 확정한 뒤에만 실행하세요. '
       'test 결과를 보고 설정을 선택하지 않습니다. 실행 후 4번 셀을 다시 실행하면 test 결과도 ZIP에 포함됩니다.')
    code('''RUN_FINAL_TEST = False
if RUN_FINAL_TEST:
    subprocess.run([sys.executable, '-u', str(WORK / 'train_group_baseline.py'),
                    '--data-dir', str(WORK / 'dataset'), '--output-dir', str(RESULTS),
                    '--batch-size', str(BATCH_SIZE), '--evaluate-test'], check=True)
else:
    print('test 평가 보류. 우선 val 기준선을 확인하세요.')
''')
    notebook = dict(cells=cells, metadata=dict(accelerator='GPU', kernelspec=dict(display_name='Python 3', language='python', name='python3'), language_info=dict(name='python', version='3.12')), nbformat=4, nbformat_minor=5)
    for i, cell in enumerate(cells):
        cell['id'] = f'group-baseline-{i:02d}'
        if cell['cell_type'] == 'code':
            compile(''.join(cell['source']), f'cell_{i}', 'exec')
    (ROOT / 'ml/cropy_group_baseline.ipynb').write_text(json.dumps(notebook, ensure_ascii=False, indent=1), encoding='utf-8')


if __name__ == '__main__':
    main()
