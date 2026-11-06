"""무 질병 라벨 정리본(1차 육안 감사) 재학습 노트북 생성."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ns = {'__file__': str(HERE / 'make_hires_nb.py'), '__name__': 'hr'}
exec((HERE / 'make_hires_nb.py').read_text(encoding='utf-8'), ns)
c1 = ns['c1'].replace("RUN = TS / 'hires448_v1'", "RUN = TS / 'cleanlabel_v1'") \
             .replace("'trainer': TS / 'train_full_colab_convnext.py'", "'trainer': TS / 'train_full_colab_seed.py', 'audit': TS / 'radish_audit_v1.json'") \
             .replace("'baseline': TS / 'baseline_v1/best_model.pth'", "'hires448': TS / 'hires448_v1/best_model.pth'")
assert 'cleanlabel_v1' in c1 and 'radish_audit_v1.json' in c1 and 'hires448_v1' in c1
c2, md1 = ns['c2'], ns['md1']

md0 = """# Cropy 작업자 분리 시험셋: 무 질병 라벨 정리 후 448px 재학습

시험셋 육안 감사에서 "무검은무늬병" 라벨 사진의 절반 이상이 검은 점 병반이 안 보였고, "무노균병" 라벨과 겉보기가 같은 사진도 있었습니다. 학습·검증의 무 질병 499장도 같은 기준으로 1차 분류해(`radish_audit_v1.json`) **라벨과 병반 양상이 맞는 사진만 남기고** 448px 10클래스 모델을 다시 학습합니다.

- 제외: 무검은무늬병인데 B/Bf(검은·갈색 반점) 양상이 아닌 113장, 무노균병인데 A(회백색 반점+갈색 테두리) 양상이 아닌 40장 → 학습·검증에서 153장 제거(무검은무늬 326→213, 무노균 173→133). 다른 클래스는 그대로.
- 학습: `hires448_v1`과 같은 설정(ResNet50, 448px, 흐림 증강, 클래스 균형, lr 1e-4, 8 epoch). 정리본은 seed 42·1·2 세 번, 대조군(정리 안 한 분할)은 seed 1·2 두 번 더 학습해 seed 잡음과 구분합니다. seed 42 대조군은 `hires448_v1/best_model.pth`를 그대로 씁니다.
- 평가: 시험 작업자 사진 전체(macro F1, 회귀 확인), 무 질병 290장, 그리고 **라벨·양상이 일치하는 166장**(검은무늬 99·노균 67)에서 정리본과 대조군을 seed별로 비교합니다.
- 결과: `MyDrive/cropy_testset/cleanlabel_v1/` (`clean_s{42,1,2}.pth`, `control_s{1,2}.pth`, `test_report.json`, `predictions_*.csv`)
- A100 기준 학습 1회 약 1시간, 5회 5시간 안팎. 끊기면 위에서부터 다시 실행하면 완료된 모델은 건너뛰고 진행 중이던 모델은 마지막 epoch부터 이어집니다.

**GPU 런타임(A100)** 에서 위에서부터 차례로 실행하세요."""

md1b = "## 1b. 감사 결과로 무 질병 사진 제외한 분할 만들기\n`split/`은 그대로 두고(대조군·평가용), 제외 목록을 뺀 복사본 `split_clean/`을 만듭니다(복사 대신 하드링크)."

c2b = """import os
AUDIT = json.loads(SOURCES['audit'].read_text(encoding='utf-8'))
EXCLUDE = set(AUDIT['exclude_trainval'])
CLEAN = WORK / 'split_clean'
if not (WORK / 'clean_done').exists():
    shutil.rmtree(CLEAN, ignore_errors=True)
    removed = {'train': 0, 'val': 0}
    for s in ('train', 'val'):
        for path in sorted((SPLIT / s).glob('*/*')):
            if path.stem in EXCLUDE:
                removed[s] += 1; continue
            dest = CLEAN / s / path.parent.name / path.name
            dest.parent.mkdir(parents=True, exist_ok=True)
            os.link(path, dest)
    assert sum(removed.values()) == len(EXCLUDE), (removed, len(EXCLUDE))
    print('제외:', removed)
    (WORK / 'clean_done').touch()
(CLEAN.parent / 'manifest.csv').write_text(fingerprint + f"audit: {digest(SOURCES['audit'])}\\n", encoding='utf-8')
clean_counts = {s: {c.name: len(list(c.iterdir())) for c in sorted((CLEAN / s).iterdir())} for s in ('train', 'val')}
for s, cs in clean_counts.items():
    print('clean', s, sum(cs.values()), {k: v for k, v in cs.items() if k.startswith(('2_', '3_'))})
assert clean_counts['train']['2_무검은무늬병'] == 179 and clean_counts['val']['2_무검은무늬병'] == 34
assert clean_counts['train']['3_무노균병'] == 85 and clean_counts['val']['3_무노균병'] == 48
CLEAN_IMAGES = (sum(clean_counts['train'].values()), sum(clean_counts['val'].values()))
(RUN / 'split_counts_clean.json').write_text(json.dumps(clean_counts, ensure_ascii=False, indent=1), encoding='utf-8')
print('정리본 학습/검증:', CLEAN_IMAGES, '원본:', EXPECT_IMAGES)"""

md2 = "## 2. 학습 (정리본 seed 42·1·2, 대조군 seed 1·2)\n학습 스크립트는 `--seed`만 추가한 판(`train_full_colab_seed.py`). 메모리 부족이 나면 1번 셀의 BATCH_SIZE를 8로 줄이세요."

c3 = """shutil.copyfile(SOURCES['trainer'], WORK / 'code/train_full_colab.py')
RUNS = (('clean_s42', CLEAN, 42), ('clean_s1', CLEAN, 1), ('control_s1', SPLIT, 1), ('clean_s2', CLEAN, 2), ('control_s2', SPLIT, 2))
for tag, data, seed in RUNS:
    out = RUN / tag
    if (RUN / f'{tag}.pth').exists():
        print(tag, '이미 완료'); continue
    n_train, n_val = CLEAN_IMAGES if data is CLEAN else EXPECT_IMAGES
    command = [sys.executable, '-u', str(WORK / 'code/train_full_colab.py'),
        '--data-dir', str(data), '--output-dir', str(out),
        '--epochs', str(EPOCHS), '--batch-size', str(BATCH_SIZE), '--lr', str(LR), '--seed', str(seed),
        '--num-workers', '4', '--img-size', str(IMG_SIZE), '--arch', 'resnet50', '--blur-aug',
        '--expect-images', str(n_train), str(n_val)]
    if (out / 'last_checkpoint.pth').exists():
        command.append('--resume')
    print('==', tag, '이어 학습:', '--resume' in command)
    subprocess.run(command, check=True)
    shutil.copyfile(out / 'best_model.pth', RUN / f'{tag}.pth')"""

md3 = "## 3. 평가\n시험 작업자 사진 전체, 무 질병 290장, 라벨·양상 일치 166장에서 정리본·대조군을 seed별로 비교하고 McNemar를 계산합니다."

c4 = """from PIL import Image
from torchvision import transforms
from math import comb
import statistics

def load(path):
    ckpt = torch.load(path, map_location='cpu', weights_only=True)
    sys.path.insert(0, str(WORK / 'code'))
    from train_full_colab import build_model
    model = build_model(ckpt.get('arch', 'resnet50'), ckpt['num_classes'], pretrained=False)
    model.load_state_dict(ckpt['model_state_dict'])
    return model.cuda().eval(), ckpt

def predict(model, size, files, bs=64):
    tf = transforms.Compose([transforms.Resize((size, size)), transforms.ToTensor(),
                             transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])
    out = []
    for i in range(0, len(files), bs):
        with torch.no_grad():
            out.append(model(torch.stack([tf(Image.open(p).convert('RGB')) for p in files[i:i + bs]]).cuda()).softmax(1).cpu().numpy())
    return np.concatenate(out)

def macro_f1(y, pred, ids):
    cm = np.zeros((len(ids), len(ids)), dtype=np.int64)
    for a, b in zip(y, pred):
        cm[ids.index(a), ids.index(b)] += 1
    rec = cm.diagonal() / np.maximum(cm.sum(1), 1); prec = cm.diagonal() / np.maximum(cm.sum(0), 1)
    return float((2 * rec * prec / np.maximum(rec + prec, 1e-9)).mean()), {str(c): round(float(r), 4) for c, r in zip(ids, rec)}

def mcnemar(ca, cb):
    n01, n10 = int((ca & ~cb).sum()), int((~ca & cb).sum()); n = n01 + n10; k = min(n01, n10)
    return dict(only_first=n01, only_second=n10, p=round(min(1.0, 2 * sum(comb(n, i) for i in range(k + 1)) / 2 ** n) if n else 1.0, 4))

files = sorted((SPLIT / 'test').glob('*/*'))
y = np.array([int(p.parent.name.split('_')[0]) for p in files])
stems = [p.stem for p in files]
radish = np.isin(y, [2, 3])
consistent = np.array([s in set(AUDIT['test_consistent']) for s in stems])
assert consistent.sum() == 166, consistent.sum()
MODELS = [('control_s42', SOURCES['hires448'])] + [(tag, RUN / f'{tag}.pth') for tag, _, _ in RUNS if (RUN / f'{tag}.pth').exists()]
correct, report = {}, {'runs': {}}
for tag, path in MODELS:
    model, ckpt = load(path)
    ids = [int(c.split('_', 1)[0]) for c in ckpt['classes']]
    probs = predict(model, ckpt.get('img_size', 448), files)
    pred = np.array(ids)[probs.argmax(1)]
    correct[tag] = pred == y
    f1, rec = macro_f1(y, pred, ids)
    def sub(mask):
        yy, pp = y[mask], pred[mask]
        r2 = float((pp[yy == 2] == 2).mean()); r3 = float((pp[yy == 3] == 3).mean())
        return dict(n=int(mask.sum()), accuracy=round(float((pp == yy).mean()), 4), recall_2=round(r2, 4), recall_3=round(r3, 4), balanced=round((r2 + r3) / 2, 4))
    report['runs'][tag] = dict(epoch=int(ckpt['epoch']), all=dict(n=int(len(y)), accuracy=round(float((pred == y).mean()), 4), macro_f1=round(f1, 4), recall=rec),
                               radish290=sub(radish), consistent166=sub(consistent))
    with (RUN / f'predictions_{tag}_test.csv').open('w', newline='', encoding='utf-8') as f:
        w = csv.writer(f); w.writerow(['file', 'label', 'pred'] + [f'p{i}' for i in ids])
        for p, yy, pp, pr in zip(files, y, pred, probs):
            w.writerow([p.name, int(yy), int(pp)] + [round(float(v), 5) for v in pr])
    r = report['runs'][tag]
    print(f"{tag}: 전체 F1 {r['all']['macro_f1']:.3f} | 무 290 정확도 {r['radish290']['accuracy']:.1%} (r2 {r['radish290']['recall_2']:.1%}, r3 {r['radish290']['recall_3']:.1%}) | 일치 166 정확도 {r['consistent166']['accuracy']:.1%} (r2 {r['consistent166']['recall_2']:.1%}, r3 {r['consistent166']['recall_3']:.1%})")
    del model
for seed in (42, 1, 2):
    a, b = f'control_s{seed}', f'clean_s{seed}'
    if a in correct and b in correct:
        report[f'mcnemar_s{seed}_control_vs_clean_166'] = mcnemar(correct[a][consistent], correct[b][consistent])
        report[f'mcnemar_s{seed}_control_vs_clean_290'] = mcnemar(correct[a][radish], correct[b][radish])
summary = {}
for group in ('control', 'clean'):
    tags = [t for t in report['runs'] if t.startswith(group)]
    for subset in ('radish290', 'consistent166'):
        for key in ('accuracy', 'recall_2', 'recall_3', 'balanced'):
            vals = [report['runs'][t][subset][key] for t in tags]
            summary[f'{group}_{subset}_{key}'] = dict(n_runs=len(vals), mean=round(statistics.mean(vals), 4), std=round(statistics.pstdev(vals), 4), values=vals)
    vals = [report['runs'][t]['all']['macro_f1'] for t in tags]
    summary[f'{group}_all_macro_f1'] = dict(n_runs=len(vals), mean=round(statistics.mean(vals), 4), std=round(statistics.pstdev(vals), 4), values=vals)
report['summary'] = summary
report['excluded_trainval'] = len(EXCLUDE)
(RUN / 'test_report.json').write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf-8')
for k, v in summary.items():
    print(k, f"{v['mean']:.3f}±{v['std']:.3f}", v['values'])
print({k: v for k, v in report.items() if k.startswith('mcnemar')})
print('저장:', RUN / 'test_report.json')"""


def cell(kind, source):
    d = {'cell_type': kind, 'metadata': {}, 'source': source.splitlines(True)}
    if kind == 'code':
        d.update(outputs=[], execution_count=None)
        compile(source, 'cell', 'exec')
    return d


nb = {'nbformat': 4, 'nbformat_minor': 0,
      'metadata': {'accelerator': 'GPU', 'colab': {'gpuType': 'A100', 'provenance': []},
                   'kernelspec': {'name': 'python3', 'display_name': 'Python 3'}, 'language_info': {'name': 'python'}},
      'cells': [cell('markdown', md0), cell('code', c1), cell('markdown', md1), cell('code', c2),
                cell('markdown', md1b), cell('code', c2b), cell('markdown', md2), cell('code', c3),
                cell('markdown', md3), cell('code', c4)]}
(HERE / 'cropy_testset_cleanlabel_colab.ipynb').write_text(json.dumps(nb, ensure_ascii=False), encoding='utf-8')
print('ok')
