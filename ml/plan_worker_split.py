"""Assign whole AI Hub workers to train/val/test so that test workers never appear in training.

Input: manifest.csv of cropy_full_512.zip (data/full/prepared_deduplicated_v1/manifest.csv).
Output: workers.json (worker -> split), split_summary.json and worker_split_v1.csv (one row per image).
Nothing is moved; ml/cropy_testset_baseline_colab.ipynb applies workers.json on Colab.

    python ml/plan_worker_split.py --manifest data/full/prepared_deduplicated_v1/manifest.csv --out ml/worker_split_v1
"""
import argparse, csv, json, random, re
from collections import Counter, defaultdict
from pathlib import Path
GROUP = re.compile(r'(?:^|_)([0-9A-Za-z]+)_(20\d{6})(?=_|\.|$)')
SPLITS = ['train', 'val', 'test']
RATIO = [0.70, 0.10, 0.20]
MIN_WORKERS = {'val': 1, 'test': 2}  # per class
CLASSES = [str(i) for i in range(9)]


def worker_of(name):
    m = GROUP.search(name)
    return m.group(1) if m else None


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--manifest', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    a = p.parse_args()
    HERE = a.out
    HERE.mkdir(parents=True, exist_ok=True)
    rows = list(csv.DictReader(a.manifest.open(encoding='utf-8-sig')))
    for r in rows:
        r['worker'] = worker_of(r['path'])
    per_worker = defaultdict(Counter)
    for r in rows:
        if r['worker']:
            per_worker[r['worker']][r['class_id']] += 1
    workers = sorted(per_worker)
    totals = Counter(r['class_id'] for r in rows if r['worker'])
    target = {s: {c: totals[c] * RATIO[i] for c in CLASSES} for i, s in enumerate(SPLITS)}

    def cost(counts, nworkers):
        dev = sum(((counts[s][c] - target[s][c]) / max(target[s][c], 1)) ** 2 for s in SPLITS for c in CLASSES)
        short = sum(max(0, n - nworkers[s][c]) for s, n in MIN_WORKERS.items() for c in CLASSES)
        return dev + 3.0 * short

    def feasible(assign):
        nw = {s: Counter() for s in SPLITS}
        for w, s in assign.items():
            for c in per_worker[w]:
                nw[s][c] += 1
        return all(nw[s][c] >= n for s, n in MIN_WORKERS.items() for c in CLASSES)

    best = None
    for trial in range(2000):
        rng = random.Random(trial)
        order = workers[:]
        rng.shuffle(order)
        order.sort(key=lambda w: sum(per_worker[w].values()) * (0.5 + rng.random()), reverse=True)
        counts = {s: Counter() for s in SPLITS}
        nworkers = {s: Counter() for s in SPLITS}
        assign = {}
        for w in order:
            scored = []
            for s in SPLITS:
                tc = {k: v.copy() for k, v in counts.items()}
                tn = {k: v.copy() for k, v in nworkers.items()}
                tc[s].update(per_worker[w])
                tn[s].update(per_worker[w].keys())
                scored.append((cost(tc, tn) + rng.random() * 1e-6, s))
            s = min(scored)[1]
            assign[w] = s
            counts[s].update(per_worker[w])
            nworkers[s].update(per_worker[w].keys())
        if not feasible(assign):
            continue
        score = cost(counts, nworkers)
        if best is None or score < best[0]:
            best = (score, assign, counts, trial)
    assert best, 'no feasible assignment'
    score, assign, counts, seed = best

    out_rows = []
    for r in rows:
        split = assign[r['worker']] if r['worker'] else 'train'
        out_rows.append(dict(path=r['path'], class_id=r['class_id'], worker=r['worker'] or '', split=split, sha256=r['sha256']))
    with (HERE / 'worker_split_v1.csv').open('w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=list(out_rows[0]))
        w.writeheader()
        w.writerows(out_rows)
    # same bytes must not straddle splits
    by_hash = defaultdict(set)
    for r in out_rows:
        by_hash[r['sha256']].add(r['split'])
    assert all(len(v) == 1 for v in by_hash.values()), 'duplicate bytes across splits'

    nw = {s: {c: sorted(w for w, s2 in assign.items() if s2 == s and per_worker[w][c]) for c in CLASSES} for s in SPLITS}
    summary = dict(seed=seed, objective=round(score, 4), ratio=RATIO, min_workers=MIN_WORKERS,
                   images={s: {c: counts[s][c] for c in CLASSES} for s in SPLITS},
                   workers={s: {c: nw[s][c] for c in CLASSES} for s in SPLITS},
                   ungrouped_to_train=sum(1 for r in rows if not r['worker']))
    (HERE / 'workers.json').write_text(json.dumps(dict(seed=seed, assign=assign), ensure_ascii=False, indent=1), encoding='utf-8')
    (HERE / 'split_summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding='utf-8')
    print('seed', seed, 'objective', round(score, 4))
    print('class | train | val | test | test share | test workers')
    for c in CLASSES:
        t = sum(counts[s][c] for s in SPLITS)
        print(c, counts['train'][c], counts['val'][c], counts['test'][c], f"{counts['test'][c] / t:.0%}", ','.join(nw['test'][c]), sep=' | ')


if __name__ == '__main__':
    main()
