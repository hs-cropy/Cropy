import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppFrame } from "@/components/AppFrame";
import { OfflineFallback } from "@/components/OfflineFallback";

export const metadata: Metadata = {
  title: "CropCare AI",
  description: "AI 기반 농작물 병해충 진단 및 스마트 방제 지원 플랫폼",
  appleWebApp: { capable: true, title: "CropCare", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#F7F7F8",
  width: "device-width",
  initialScale: 1,
  // viewport-fit=cover가 있어야 iOS에서 safe-area inset을 올바르게 적용할 수 있다.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // 아래 인라인 스크립트가 하이드레이션 전에 data-textsize를 붙이므로
    // 서버 HTML과 달라진다. 이 요소의 속성 차이만 경고에서 제외한다.
    <html lang="ko" suppressHydrationWarning>
      <head>
        {/* 저장된 큰글씨 설정을 첫 페인트 전에 적용한다.
            React 하이드레이션을 기다리면 글씨가 작았다 커지며 깜빡인다. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('cropcare:textsize')==='large')" +
              "document.documentElement.dataset.textsize='large'}catch(e){}",
          }}
        />
      </head>
      <body>
        {/* 각 화면이 AppShellPage 로 <main> 을 그린다 */}
        <AppFrame>{children}</AppFrame>
        <OfflineFallback />
      </body>
    </html>
  );
}
