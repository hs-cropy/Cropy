import { describe, expect, it } from "vitest";
import tailwindConfig from "../../tailwind.config.js";
import { cn } from "./cn";

describe("cn", () => {
  it("거짓 값은 빼고 합친다", () => {
    expect(cn("flex", false, null, undefined, "", "gap-2")).toBe("flex gap-2");
    expect(cn("flex", { "w-full": true, hidden: false })).toBe("flex w-full");
  });

  it("같은 속성을 다루는 클래스는 뒤에 온 것만 남긴다", () => {
    expect(cn("inline-flex", "block")).toBe("block");
    expect(cn("cursor-not-allowed", "cursor-pointer")).toBe("cursor-pointer");
    expect(cn("px-4 py-2", "px-6")).toBe("py-2 px-6");
  });

  it("글자 크기 토큰과 글자색 토큰을 서로 지우지 않는다", () => {
    expect(cn("text-cropy-compact-button", "text-cropy-text-on-action")).toBe(
      "text-cropy-compact-button text-cropy-text-on-action",
    );
    expect(cn("text-sm", "text-cropy-compact-button")).toBe("text-cropy-compact-button");
    expect(cn("text-cropy-text-primary", "text-cropy-text-disabled")).toBe(
      "text-cropy-text-disabled",
    );
  });
});

// tailwind.config.js에 키를 추가하고 cn.ts 등록을 빠뜨리면 여기서 실패한다
describe("cn — tailwind.config.js의 직접 추가한 키", () => {
  const extend = tailwindConfig.theme?.extend as Record<string, Record<string, unknown>>;
  const groups = [
    // [유틸 접두사, 설정 키 목록, Tailwind 기본 스케일에서 같은 속성을 다루는 클래스]
    ["text", Object.keys(extend.fontSize), "text-2xl"],
    ["rounded", Object.keys(extend.borderRadius), "rounded-lg"],
    ["h", Object.keys(extend.height), "h-10"],
    ["min-h", Object.keys(extend.minHeight), "min-h-0"],
    ["max-w", Object.keys(extend.maxWidth), "max-w-md"],
    ["shadow", Object.keys(extend.boxShadow), "shadow-md"],
    ["animate", Object.keys(extend.animation), "animate-spin"],
  ] as const;

  it("위 목록에 없는 종류의 키가 설정에 생기면 cn.ts 등록과 이 테스트를 함께 고친다", () => {
    // colors: tailwind-merge가 색 이름은 무엇이든 받아 등록이 필요 없다
    // fontFamily: 기본 키(sans)만 재정의한다
    // keyframes: 클래스가 아니라 animation 이 이름으로 부른다
    expect(Object.keys(extend).sort()).toEqual([
      "animation",
      "borderRadius",
      "boxShadow",
      "colors",
      "fontFamily",
      "fontSize",
      "height",
      "keyframes",
      "maxWidth",
      "minHeight",
    ]);
  });

  const cases = groups.flatMap(([prefix, keys, builtin]) =>
    keys.map((key) => [`${prefix}-${key}`, builtin] as const),
  );

  it.each(cases)("%s 는 %s 와 서로 덮어쓴다", (custom, builtin) => {
    expect(cn(builtin, custom)).toBe(custom);
    expect(cn(custom, builtin)).toBe(builtin);
  });
});
