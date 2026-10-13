import { AppShellPage } from "@/components/AppShell";
import { DiagnoseForm } from "@/components/DiagnoseForm";

export default function HomePage() {
  return (
    <AppShellPage scrollLabel="진단하기">
      {/* 옛 화면의 위 여백과 본문 최대 폭. 화면을 새로 쓸 때 PageHeader 로 바꾸고 지운다 */}
      <div className="mx-auto w-full max-w-[27.5rem] pt-5 md:max-w-[44rem] md:pt-8 lg:max-w-[60rem]">
        <section className="mb-5 md:mb-7">
          <h1 className="text-[1.4375rem] font-extrabold leading-snug tracking-tight text-ink md:text-[1.75rem]">
            사진 한 장으로 <br className="md:hidden" />
            병해충을 진단하세요
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted md:text-base">
            잎이나 과실을 촬영하면 AI가 병해충과 방제법을 알려드려요.
          </p>
          {/* 기기 안에서 진단하는 정적 페이지. 앱에서 그 페이지로 가는 길은 여기뿐이다 */}
          <a
            href="/offline/index.html"
            className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-bold text-brown hover:text-ink"
          >
            인터넷 없이 기기에서 진단하기
            <span aria-hidden className="icon-[lucide--chevron-right] h-4 w-4" />
          </a>
        </section>
        <DiagnoseForm />
      </div>
    </AppShellPage>
  );
}
