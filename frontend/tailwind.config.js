const { addDynamicIconSelectors } = require("@iconify/tailwind");

/** @type {import('tailwindcss').Config} */
module.exports = {
  // 화면에 쓰지 않는 클래스가 앱 CSS에 섞이지 않게 테스트·스토리 파일과
  // cn.ts(설정 키 shadow가 클래스로 읽힌다)는 뺀다.
  // 스토리는 .storybook/tailwind.config.js 가 따로 스캔한다
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "!./src/**/*.test.{ts,tsx}",
    "!./src/**/*.stories.{ts,tsx}",
    "!./src/lib/cn.ts",
  ],
  theme: {
    extend: {
      colors: {
        // Warm, clean palette — brown / khaki / yellow
        paper: "#FBF8F1", // soft warm background
        surface: "#FFFFFF", // cards
        ink: "#3D2F1A", // primary text (deep warm brown)
        muted: "#7A6C50", // secondary text
        line: "#ECE5D6", // hairline dividers
        khaki: {
          // darkened from #8C7B54 — the old value was 3.4:1 on khaki-tint,
          // unreadable outdoors for the older farmers this is built for
          DEFAULT: "#766747", // captions / muted accents — 5.5:1 on white
          tint: "#EFEAD9", // soft fills, chips
        },
        brown: {
          DEFAULT: "#6F4E2E",
          deep: "#573A1F",
        },
        brand: {
          DEFAULT: "#F5B301", // yellow — primary action / highlight
          deep: "#DE9F00", // pressed (fill only — fails contrast as text)
          ink: "#916800", // brand-colored TEXT/icons — 4.5:1 on brand-tint
          tint: "#FDF3D3", // highlight background
        },
        // Camera viewfinder (dark, full-screen)
        photo: {
          deep: "#1E3326", // viewfinder background
          "leaf-light": "#8DB36A", // gallery thumbnail placeholder
        },
        scrim: "#0F1A12", // chips over the camera feed
        // Diagnostic severity signals (warm-tuned).
        // Each has a fill colour (dots, borders) and an -ink colour for text and
        // icons. The fills keep the original hue; the -ink values are darkened to
        // clear 4.5:1 on their own tint background.
        signal: {
          low: "#5E8C4F",
          "low-ink": "#4F7542",
          "low-tint": "#E7F0E0",
          med: "#E8A81C",
          "med-ink": "#8D650E",
          "med-tint": "#FBEFCF",
          high: "#C0522E",
          "high-ink": "#A94829",
          "high-tint": "#F6E2D8",
        },
        // Figma 디자인 토큰. 기준은 "V2 최신 · Cropy Design System"(node 281:6722)이다.
        // 키는 Figma 변수 이름을 따른다: --cropy-color-green-600 → cropy-green-600,
        // color/action/hover → cropy-action-hover.
        // (-default 만 DEFAULT 키로 접는다: surface-default → cropy-surface)
        // 새 공통 컴포넌트는 이 토큰만 쓰고, 위의 옛 팔레트(brand·ink·khaki 등)는
        // 화면을 모두 옮긴 뒤 지운다. 그때까지는 두 체계가 함께 남는다.
        // overlay/scrim 은 위의 scrim 과 값이 같아 따로 두지 않는다.
        cropy: {
          green: {
            50: "#edf7f1", // 선택된 탭·칩 배경
            600: "#2e8b57",
          },
          text: {
            primary: "#191919",
            secondary: "#6b6b6b",
            disabled: "#a5a5a5",
            "on-action": "#ffffff",
          },
          surface: {
            DEFAULT: "#ffffff", // surface-default
            canvas: "#f7f7f8",
          },
          border: {
            DEFAULT: "#ececef", // border-default
          },
          // 행동(버튼·스위치) 색. primary 는 green-600, subtle 은 green-50 과 값이 같다
          action: {
            primary: "#2e8b57", // 흰 글자와 4.25:1 이라 작은 글자색으로는 쓰지 않는다
            hover: "#26784b",
            pressed: "#1f633d",
            subtle: "#edf7f1",
            disabled: "#ececef",
          },
          // 등급 색. 디자인 시스템의 등급 배지는 "위험"과 "주의"에 같은 attention 색을
          // 쓰고 라벨로 구분한다. signal-*-ink 같은 글자 전용 값이 없어
          // 자기 -surface 위의 작은 글자로는 대비가 모자란다 (low 3.9:1, attention 4.4:1)
          status: {
            low: "#2e8b57",
            "low-surface": "#edf7f1",
            attention: "#d92d20",
            "attention-surface": "#fff1f0",
          },
        },
      },
      // 본문 크기를 한 단계씩 올린다. 주 사용자가 고령 농업인이라 Tailwind
      // 기본값(xs 12px / sm 14px)은 밭에서 읽기에 너무 작다.
      // 클래스명은 그대로 두고 스케일만 재정의해 화면 전체가 일관되게 커진다.
      // 한글은 라틴 문자보다 자간이 촘촘해 행간도 함께 넉넉히 잡는다.
      fontSize: {
        xs: ["0.875rem", { lineHeight: "1.375rem" }], // 12 → 14px
        sm: ["1rem", { lineHeight: "1.625rem" }], // 14 → 16px
        base: ["1.125rem", { lineHeight: "1.75rem" }], // 16 → 18px
        lg: ["1.25rem", { lineHeight: "1.875rem" }], // 18 → 20px
        // 디자인 시스템의 글자 스타일 (Cropy/V2/Type/*). 굵기·자간까지 한 클래스에 담는다.
        // 자간은 디자인 시스템 페이지의 설명(-1.5%·-1%)을 따랐다. Figma 스타일 정의에는
        // 0 으로 들어 있어 디자이너 확인이 필요하다. 자간이 없는 스타일도 0em 을 적어
        // 바깥 제목의 자간을 물려받지 않게 한다.
        // 위의 xs~lg 는 옛 화면용이고, 새 컴포넌트는 아래 스타일을 쓴다.
        "cropy-title-desktop": [
          "2rem", // 32px
          { lineHeight: "2.75rem", fontWeight: "700", letterSpacing: "-0.015em" },
        ],
        "cropy-title-mobile": [
          "1.375rem", // 22px
          { lineHeight: "1.875rem", fontWeight: "700", letterSpacing: "-0.015em" },
        ],
        "cropy-heading-lg": [
          "1.5rem", // 24px
          { lineHeight: "2rem", fontWeight: "700", letterSpacing: "-0.015em" },
        ],
        "cropy-heading-md": [
          "1.25rem", // 20px
          { lineHeight: "1.75rem", fontWeight: "700", letterSpacing: "-0.01em" },
        ],
        "cropy-feedback-title": [
          "1.125rem", // 18px
          { lineHeight: "1.625rem", fontWeight: "700", letterSpacing: "-0.01em" },
        ],
        "cropy-body-lg": [
          "1rem", // 16px
          { lineHeight: "1.5rem", fontWeight: "400", letterSpacing: "0em" },
        ],
        "cropy-feedback-body": [
          "0.9375rem", // 15px
          { lineHeight: "1.375rem", fontWeight: "400", letterSpacing: "0em" },
        ],
        "cropy-helper": [
          "0.875rem", // 14px
          { lineHeight: "1.375rem", fontWeight: "400", letterSpacing: "0em" },
        ],
        "cropy-caption": [
          "0.8125rem", // 13px
          { lineHeight: "1.25rem", fontWeight: "400", letterSpacing: "0em" },
        ],
        "cropy-label-xs": [
          "0.75rem", // 12px
          { lineHeight: "1.125rem", fontWeight: "700", letterSpacing: "0em" },
        ],
        // 피드백 카드 안 44px 버튼의 글자 (Cropy/Feedback/Mobile/Compact/button)
        "cropy-compact-button": [
          "0.9375rem", // 15px
          { lineHeight: "1.45", fontWeight: "700", letterSpacing: "0em" },
        ],
      },
      fontFamily: {
        sans: ["Pretendard", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "1.125rem",
        // --cropy-radius-*. 8·12·16·24px·pill 은 기본 rounded-lg·xl·2xl·3xl·full 과 값이
        // 같아 그대로 쓰고(그래서 그 키들은 재정의하지 않는다), 기본 스케일에 없는 값만 둔다.
        "cropy-14": "0.875rem",
        "cropy-20": "1.25rem",
      },
      // --cropy-size-*. 큰글씨 모드에서 함께 커지도록 rem 으로 둔다.
      // --cropy-space-* 는 기본 간격 스케일에 모두 있어 따로 두지 않는다
      // (2·4·6·8·12·16·20·24·32·40·48·64px → 0.5·1·1.5·2·3·4·5·6·8·10·12·16).
      height: {
        "cropy-button-mobile": "3.25rem", // 52px
        "cropy-button-web": "3rem", // 48px
        "cropy-control-md": "2.75rem", // 44px
      },
      minHeight: {
        "cropy-button-mobile": "3.25rem",
        "cropy-button-web": "3rem",
        "cropy-control-md": "2.75rem",
      },
      boxShadow: {
        card: "0 1px 2px rgba(61,47,26,0.05), 0 6px 20px -14px rgba(61,47,26,0.18)",
        cta: "0 8px 18px -10px rgba(245,179,1,0.7)",
      },
      maxWidth: {
        app: "30rem",
      },
    },
  },
  plugins: [addDynamicIconSelectors()],
};
