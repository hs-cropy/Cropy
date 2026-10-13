"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { LegacyPage } from "@/components/LegacyPage";
import { fetchHistory } from "@/lib/api";
import type { DiagnosisSummary, Severity } from "@/types/diagnosis";
const GRADES = { high: "위험", medium: "주의", low: "낮음" };
export default function HistoryPage() {
  const [items, setItems] = useState<DiagnosisSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [crop, setCrop] = useState("");
  const [grade, setGrade] = useState<Severity | "">("");
  const [page, setPage] = useState(1);
  const [counts, setCounts] = useState({ total: 0, unfiltered: 0 });
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null);
    fetchHistory(page, 20, crop || undefined, grade || undefined, controller.signal)
      .then(data => {
        if (controller.signal.aborted) return;
        setItems(data.items); setCounts({ total: data.total, unfiltered: data.unfiltered_total });
      })
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "이력을 불러오지 못했어요."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [crop, grade, page, refresh]);
  return <LegacyPage scrollLabel="진단 이력">
    <h1 className="mb-5 text-2xl font-extrabold">진단 이력</h1>
    <div className="mb-4 flex flex-wrap gap-3">
      <label>작물 <select className="rounded-lg border p-2" value={crop} onChange={e => { setCrop(e.target.value); setPage(1); }}>
        <option value="">전체 작물</option>{["고추", "무", "배추"].map(c => <option key={c}>{c}</option>)}
      </select></label>
      <label>등급 <select className="rounded-lg border p-2" value={grade} onChange={e => { setGrade(e.target.value as Severity | ""); setPage(1); }}>
        <option value="">전체 등급</option>{Object.entries(GRADES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
    </div>
    {loading && <p role="status" className="py-6">불러오는 중…</p>}
    {error && <div role="alert" className="mb-4 rounded-xl bg-signal-high-tint p-4">
      <p>{error}</p><button className="mt-2 rounded-lg bg-brand px-4 py-2" onClick={() => setRefresh(x => x + 1)}>다시 불러오기</button>
    </div>}
    {!loading && !error && <p className="mb-3 text-sm text-muted">{counts.total}건</p>}
    {!loading && !error && !items.length && <div className="rounded-card border border-line bg-surface p-8 text-center">
      <p className="font-bold">{counts.unfiltered === 0 ? "아직 진단 기록이 없어요" : "선택한 조건의 기록이 없어요"}</p>
      {counts.unfiltered === 0 ? <Link href="/" className="mt-3 inline-block rounded-xl bg-brand px-5 py-2">진단 시작</Link> :
      <button className="mt-3 rounded-xl bg-brand px-5 py-2" onClick={() => { setCrop(""); setGrade(""); setPage(1); }}>전체 이력 보기</button>}
    </div>}
    {!loading && !error && <ul className="grid gap-3 md:grid-cols-2">{items.map(item => <li key={item.id}>
      <Link href={"/history/" + item.id} className="flex items-center gap-3 rounded-card border border-line bg-surface p-3">
        {item.image_url && <img src={item.image_url} alt="" className="h-16 w-16 rounded-xl object-cover" />}
        <div><p className="font-bold">{item.disease_name}</p>
          <p className="text-xs text-khaki">{item.crop_type} · {item.severity && GRADES[item.severity]} · {Math.round(item.confidence * 100)}%</p>
          <p className="text-xs text-muted">{new Date(item.created_at).toLocaleString("ko-KR")}</p>
          {item.is_refined && <span className="text-xs font-bold text-signal-med-ink">재촬영으로 결과 갱신됨</span>}
        </div>
      </Link>
    </li>)}</ul>}
    {!loading && !error && counts.total > 20 && <nav aria-label="이력 페이지" className="mt-5 flex justify-center gap-4">
      <button disabled={page === 1} onClick={() => setPage(x => x - 1)} className="rounded-lg border px-4 py-2 disabled:opacity-40">이전</button>
      <span>{page} / {Math.ceil(counts.total / 20)}</span>
      <button disabled={page * 20 >= counts.total} onClick={() => setPage(x => x + 1)} className="rounded-lg border px-4 py-2 disabled:opacity-40">다음</button>
    </nav>}
  </LegacyPage>;
}
