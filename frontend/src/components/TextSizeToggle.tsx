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
 * 어르신이 이 스위치를 못 찾으면 의미가 없으므로, 아이콘만 두지 않고 "큰 글자"
 * 라벨을 항상 함께 노출하며 헤더에서 가장 눈에 띄는 자리에 둔다.
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
    <Switch checked={large} onCheckedChange={change} className={className}>
      큰 글자
    </Switch>
  );
}
