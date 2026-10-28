import Link from "next/link";
import { AppShellPage } from "@/components/AppShell";

// 기본 404 화면은 높이 100vh 상자라 고정 틀 안에서 잘린다. 틀에 맞는 화면을 따로 둔다
export default function NotFound() {
  return (
    <AppShellPage scrollLabel="안내">
      <div className="mx-auto w-full max-w-[27.5rem] pt-5 md:max-w-[44rem] md:pt-8 lg:max-w-[60rem]">
        <h1 className="text-2xl font-extrabold text-ink">화면을 찾을 수 없어요</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          주소가 바뀌었거나 없는 화면이에요.
        </p>
        {/* 촬영 화면 경로(CAPTURE_PATH)와 같은 값이다. 상수가 든 DiagnosisSession 은
            "use client" 모듈이라, 서버 컴포넌트인 이 화면에서는 문자열이 아닌 클라이언트 참조로 들어온다 */}
        <Link
          href="/home"
          className="mt-5 inline-flex min-h-12 items-center rounded-xl bg-brand px-5 font-bold text-ink"
        >
          진단 화면으로
        </Link>
      </div>
    </AppShellPage>
  );
}
