"""Produce reproducible split proposals only; never move images or train models."""
import csv
import hashlib
import json
import random
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    out = ROOT/'output/colab/group_split_candidates_20260921'
    out.mkdir(exist_ok=False)
    with (ROOT/'output/colab/full_label_audit_20260921/image_label_mapping.csv').open(encoding='utf-8-sig') as f:
        rows = list(csv.DictReader(f))
    classes = sorted({r['class'] for r in rows})
    for i,r in enumerate(rows):
        with (ROOT/r['path']).open('rb') as f:
            r['sha256'] = hashlib.file_digest(f,'sha256').hexdigest()
        try:
            datetime.strptime(r['date'], '%Y/%m/%d')
            r['valid_date'] = True
        except ValueError:
            r['valid_date'] = False
        if (i+1)%500 == 0: print('hashed',i+1,flush=True)
    stats=[]
    for c in classes:
        cr=[r for r in rows if r['class']==c]
        stats.append({'class':c,'images':len(cr),'workers':len({r['filename_worker'] for r in cr}),
                      'worker_dates':len({(r['filename_worker'],r['date']) for r in cr}),
                      'invalid_date_images':sum(not r['valid_date'] for r in cr)})
    hashes=defaultdict(list)
    for i,r in enumerate(rows):hashes[r['sha256']].append(i)
    conflicts=[ids for ids in hashes.values() if len({rows[i]['class'] for i in ids})>1]
    assert not conflicts,'Same bytes have conflicting class labels; review before planning'
    reports={}
    for mode in ['worker','worker_date']:
        parent=list(range(len(rows)))
        def find(i):
            while parent[i]!=i:
                parent[i]=parent[parent[i]];i=parent[i]
            return i
        def union(a,b):parent[find(b)]=find(a)
        keys={}
        for i,r in enumerate(rows):
            key=r['filename_worker'] if mode=='worker' else (r['filename_worker'],r['date'])
            if key in keys:union(i,keys[key])
            else:keys[key]=i
        for ids in hashes.values():
            for i in ids[1:]:union(ids[0],i)
        components=defaultdict(list)
        for i in range(len(rows)):components[find(i)].append(i)
        groups=list(components.values())
        vectors=[[sum(rows[i]['class']==c for i in ids) for c in classes] for ids in groups]
        forced={g for g,ids in enumerate(groups) if any(not rows[i]['valid_date'] for i in ids)}
        totals=[sum(r['class']==c for r in rows) for c in classes]
        target=[[n*ratio for n in totals] for ratio in [.70,.15,.15]]
        def cost(counts):
            return sum(((counts[s][c]-target[s][c])/max(target[s][c],1))**2
                       for s in range(3) for c in range(9))
        best=None
        for trial in range(200):
            rng=random.Random(42+trial)
            counts=[[0]*9 for _ in range(3)];assign={}
            order=list(range(len(groups)));rng.shuffle(order)
            order.sort(key=lambda g:sum(vectors[g])*(.6+rng.random()),reverse=True)
            for g in order:
                choices=[0] if g in forced else [0,1,2]
                scores=[]
                for s in choices:
                    changed=[x[:] for x in counts]
                    changed[s]=[a+b for a,b in zip(changed[s],vectors[g])]
                    scores.append((cost(changed),s))
                _,s=min(scores);assign[g]=s
                counts[s]=[a+b for a,b in zip(counts[s],vectors[g])]
            if not all(v>0 for a in counts for v in a):continue
            score=cost(counts)
            if best is None or score<best[0]:best=(score,assign,counts,42+trial)
        assert best is not None,'No candidate has every class in all three splits'
        score,assign,counts,seed=best
        names=['train','val','test'];planned=[]
        for g,ids in enumerate(groups):
            for i in ids:
                planned.append({**rows[i],'candidate_split':names[assign[g]],'group_id':g})
        for field in ['sha256','group_id']:
            check=defaultdict(set)
            for r in planned:check[r[field]].add(r['candidate_split'])
            assert all(len(v)==1 for v in check.values())
        assert all(r['candidate_split']=='train' for r in planned if not r['valid_date'])
        with (out/f'{mode}_candidate.csv').open('w',encoding='utf-8-sig',newline='') as f:
            w=csv.DictWriter(f,fieldnames=list(planned[0]));w.writeheader();w.writerows(planned)
        reports[mode]={'groups':len(groups),'seed':seed,'objective':score,'class_counts':dict(zip(names,counts)),
          'split_counts':dict(zip(names,map(sum,counts))),
          'forced_train_groups':len(forced),'forced_train_images':sum(len(groups[g]) for g in forced),
          'moved_from_old_train_to_eval':sum(r['split']=='train' and r['candidate_split']!='train' for r in planned),
          'cross_split_exact_hashes':0,'cross_split_group_ids':0}
    summary={'classes':classes,'class_group_stats':stats,'images':len(rows),
             'unique_original_hashes':len(hashes),'duplicate_groups':sum(len(x)>1 for x in hashes.values()),
             'candidate_results':reports,'applied':False,'training_performed':False}
    (out/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(summary,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
