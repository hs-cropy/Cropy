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
        // Figma 디자인 토큰 (cropy-mobile / cropy-desktop 의 --cropy-color-* 변수).
        // 키는 Figma 변수 이름을 따른다: --cropy-color-green-600 → cropy-green-600.
        // (-default 만 DEFAULT 키로 접는다: surface-default → cropy-surface)
        // 새 공통 컴포넌트는 이 토큰만 쓰고, 위의 옛 팔레트(brand·ink·khaki 등)는
        // 화면을 모두 옮긴 뒤 지운다. 그때까지는 두 체계가 함께 남는다.
        // overlay/scrim 은 위의 scrim 과 값이 같아 따로 두지 않는다.
        cropy: {
          green: {
            50: "#edf7f1", // 선택된 탭·칩 배경
            600: "#2e8b57", // 주요 행동 — 흰 글자와 4.25:1 이라 작은 글자색으로는 쓰지 않는다
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
          action: {
            disabled: "#ececef",
          },
          // 등급 색. Figma 변수는 낮음(low)·위험(attention) 두 단계뿐이라 중간 등급
          // "주의"는 signal-med 를 계속 쓴다. signal-*-ink 같은 글자 전용 값이 없어
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
        // Figma 텍스트 스타일 (Cropy/Feedback/Mobile/*). 굵기까지 한 클래스에 담는다.
        "cropy-feedback-title": ["1.25rem", { lineHeight: "1.5", fontWeight: "700" }], // 20px
        "cropy-compact-title": ["1.125rem", { lineHeight: "1.45", fontWeight: "700" }], // 18px
        "cropy-compact-body": ["0.9375rem", { lineHeight: "1.45", fontWeight: "400" }], // 15px
        "cropy-compact-button": ["0.9375rem", { lineHeight: "1.45", fontWeight: "700" }], // 15px
      },
      fontFamily: {
        sans: ["Pretendard", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "1.125rem",
        // --cropy-radius-*. 8·12·16px·pill 은 기본 rounded-lg·xl·2xl·full 과 값이 같아
        // 그대로 쓰고(그래서 그 키들은 재정의하지 않는다), 기본 스케일에 없는 값만 둔다.
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
