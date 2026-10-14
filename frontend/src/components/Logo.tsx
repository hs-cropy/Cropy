import type { ComponentPropsWithRef } from "react";
import { cn } from "@/lib/cn";

// Figma 헤더의 로고(1448×1086, 508KB)를 여백째로 줄인 파일이다.
// 여백을 그대로 둬서 Figma 와 같은 상자에 object-contain 으로 넣으면 같은 자리에 그려진다.
// 벡터 원본이 생기면 아래 세 값과 파일만 바꾼다
const LOGO_SRC = "/brand/cropy-logo.png";
const LOGO_WIDTH = 299;
const LOGO_HEIGHT = 224;

type LogoProps = Omit<ComponentPropsWithRef<"img">, "src" | "width" | "height">;

/**
 * Cropy 로고. 기본 크기는 모바일 헤더의 70×44px 이고, 다른 크기는 className 으로 준다.
 * 링크 안에 넣어 링크가 이름을 갖고 있으면 alt="" 로 두 번 읽히지 않게 한다.
 */
export function Logo({ alt = "Cropy", className, ...rest }: LogoProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 8KB 로고라 next/image 최적화가 필요 없다
    <img
      {...rest}
      src={LOGO_SRC}
      width={LOGO_WIDTH}
      height={LOGO_HEIGHT}
      alt={alt}
      className={cn("h-11 w-[4.375rem] shrink-0 object-contain", className)}
    />
  );
}
