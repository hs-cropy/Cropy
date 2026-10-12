import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// tailwind.config.js에 직접 추가한 키는 tailwind-merge가 알지 못한다.
// 등록하지 않으면 text-cropy-compact-button(글자 크기)을 글자색으로 잘못 보고
// text-cropy-text-* 와 서로 지우고, rounded-cropy-14 같은 키는 덮어쓰기가 되지 않는다.
// 설정에 키를 더하면 여기에도 더한다 (cn.test.ts가 빠진 키를 잡아낸다)
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      borderRadius: ["card", "cropy-14", "cropy-20"],
    },
    classGroups: {
      "font-size": [
        {
          text: [
            "cropy-title-desktop",
            "cropy-title-mobile",
            "cropy-heading-lg",
            "cropy-heading-md",
            "cropy-feedback-title",
            "cropy-body-lg",
            "cropy-feedback-body",
            "cropy-helper",
            "cropy-caption",
            "cropy-label-xs",
            "cropy-compact-button",
          ],
        },
      ],
      h: [{ h: ["cropy-button-mobile", "cropy-button-web", "cropy-control-md"] }],
      "min-h": [{ "min-h": ["cropy-button-mobile", "cropy-button-web", "cropy-control-md"] }],
      "max-w": [{ "max-w": ["app"] }],
      shadow: [{ shadow: ["card", "cta"] }],
    },
  },
});

/** 조건부 클래스를 합치고, 같은 속성을 다루는 Tailwind 클래스는 뒤에 온 것만 남긴다 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
