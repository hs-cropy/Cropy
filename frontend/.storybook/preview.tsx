import { useLayoutEffect, type ReactNode } from "react";
import type { Preview } from "@storybook/nextjs-vite";
import "../src/app/globals.css";

// 앱의 <html lang="ko"> 와 맞춘다 (줄바꿈·스크린리더 발음이 달라진다)
document.documentElement.lang = "ko";

// 앱과 같은 방식으로 큰글씨 모드를 켠다 (TextSizeToggle: html[data-textsize="large"])
function TextSize({ size, children }: { size: string; children: ReactNode }) {
  // 첫 렌더에서 100% → 125% 로 튀지 않게 그리기 전에 적용한다
  useLayoutEffect(() => {
    if (size === "large") document.documentElement.dataset.textsize = "large";
    else delete document.documentElement.dataset.textsize;
  }, [size]);
  return children;
}

const preview: Preview = {
  globalTypes: {
    textsize: {
      description: "큰글씨 모드",
      toolbar: {
        title: "글자 크기",
        items: [
          { value: "normal", title: "보통 글자" },
          { value: "large", title: "큰 글자 (125%)" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    textsize: "normal",
    backgrounds: { value: "canvas" },
  },
  parameters: {
    layout: "padded",
    backgrounds: {
      options: {
        canvas: { name: "화면 배경", value: "#f7f7f8" }, // cropy-surface-canvas
        surface: { name: "카드", value: "#ffffff" }, // cropy-surface
      },
    },
  },
  decorators: [
    (Story, context) => (
      <TextSize size={context.globals.textsize}>
        <Story />
      </TextSize>
    ),
  ],
};

export default preview;
