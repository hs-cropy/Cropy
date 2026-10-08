import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // tsconfig의 "@/*" 별칭을 그대로 쓴다
    tsconfigPaths: true,
  },
  // Next용 tsconfig는 jsx: "preserve"라 테스트에서는 직접 변환한다
  oxc: {
    jsx: { runtime: "automatic" },
  },
  test: {
    // 음성·카메라 코드가 window·localStorage를 쓰므로 브라우저 흉내 환경에서 돌린다
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    // assert가 실패해도 spy가 다음 테스트로 새지 않게 매 테스트 뒤 되돌린다
    clearMocks: true,
    restoreMocks: true,
  },
});
