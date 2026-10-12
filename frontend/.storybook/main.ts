import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/nextjs-vite";
import autoprefixer from "autoprefixer";
import tailwindcss from "tailwindcss";

const config: StorybookConfig = {
  // next/link, usePathname 을 쓰는 컴포넌트(헤더·내비)도 스토리로 올릴 수 있다
  framework: "@storybook/nextjs-vite",
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y"],
  core: { disableTelemetry: true },
  // 스토리에 필요한 이미지 폴더만 연결한다 (public 전체는 아래 viteFinal 에서 꺼 둔다)
  staticDirs: [
    { from: "../public/brand", to: "/brand" },
    { from: "../public/mascot", to: "/mascot" },
  ],
  viteFinal: (viteConfig) => ({
    ...viteConfig,
    // Vite 는 기본으로 public 을 통째로 복사한다. 오프라인 앱과 dev·build 가 만드는
    // offline-runtime 까지 딸려 오므로 끄고, 이미지가 필요해지면 그 폴더만
    // staticDirs 로 연결한다
    publicDir: false,
    css: {
      ...viteConfig.css,
      // 앱의 postcss.config.js 대신 스토리까지 스캔하는 Tailwind 설정을 쓴다
      postcss: {
        plugins: [
          tailwindcss({
            config: fileURLToPath(new URL("./tailwind.config.js", import.meta.url)),
          }),
          autoprefixer(),
        ],
      },
    },
  }),
};

export default config;
