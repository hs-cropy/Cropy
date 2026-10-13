import Link from "next/link";
import { LegacyPage } from "@/components/LegacyPage";

// 기본 404 화면은 높이 100vh 상자라 고정 틀 안에서 잘린다. 틀에 맞는 화면을 따로 둔다
export default function NotFound() {
  return (
    <LegacyPage scrollLabel="안내">
      <h1 className="text-2xl font-extrabold text-ink">화면을 찾을 수 없어요</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">주소가 바뀌었거나 없는 화면이에요.</p>
      <Link
        href="/"
        className="mt-5 inline-flex min-h-12 items-center rounded-xl bg-brand px-5 font-bold text-ink"
      >
        진단 화면으로
      </Link>
    </LegacyPage>
  );
}
