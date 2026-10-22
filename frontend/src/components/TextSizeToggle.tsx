"use client";

import { useEffect, useState } from "react";
import { Switch } from "./Switch";

export const TEXT_SIZE_KEY = "cropcare:textsize";

interface TextSizeToggleProps {
  /** 배치용 클래스 (폭 등). 스위치의 모양은 Switch 가 정한다 */
  className?: string;
}

/**
 * 큰 글자 모드 스위치.
 *
 * html의 루트 폰트 크기만 바꾸면 rem 기반인 Tailwind 유틸 전체가 따라 커진다
 * (globals.css 참고). 선택은 localStorage에 남겨 한 번만 찾으면 되게 하고,
 * 첫 페인트 전에 layout.tsx의 인라인 스크립트가 같은 값을 미리 적용한다.
 *
 * 어르신이 이 스위치를 못 찾으면 의미가 없으므로, 아이콘만 두지 않고 라벨(모바일 "큰 글자",
 * md 부터 "글자 크게")을 항상 함께 노출하며 헤더에서 가장 눈에 띄는 자리에 둔다.
 * 두 라벨은 서로를 포함하지 않아 음성 스위치처럼 aria-label 로 이름을 고정하지 않는다
 * (고정하면 한쪽 폭에서 보이는 글자가 이름에 없어 WCAG 2.5.3 을 어긴다).
 */
export function TextSizeToggle({ className }: TextSizeToggleProps) {
  const [large, setLarge] = useState(false);

  // 서버 렌더 결과와 어긋나지 않도록 마운트 후 실제 DOM 상태를 읽는다
  useEffect(() => {
    setLarge(document.documentElement.dataset.textsize === "large");
  }, []);

  const change = (next: boolean) => {
    setLarge(next);
    document.documentElement.dataset.textsize = next ? "large" : "normal";
    try {
      localStorage.setItem(TEXT_SIZE_KEY, next ? "large" : "normal");
    } catch {
      // 시크릿 모드 등 저장이 막힌 경우 — 이번 세션에만 적용된다
    }
  };

  return (
    // Figma 모바일 헤더는 "큰 글자", 데스크탑 헤더는 "글자 크게"다. 음성 스위치와 같은 md 에서 바꾼다.
    // 숨긴 쪽은 display:none 이라 스크린리더는 보이는 글자만 이름으로 읽는다 (위 설명 참고)
    <Switch checked={large} onCheckedChange={change} className={className}>
      <span className="md:hidden">큰 글자</span>
      <span className="hidden md:inline">글자 크게</span>
    </Switch>
  );
}
