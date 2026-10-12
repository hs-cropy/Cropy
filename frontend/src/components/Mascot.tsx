import type { ComponentPropsWithRef } from "react";
import { cn } from "@/lib/cn";

// public/mascot 의 파일 이름이다. Figma 원본(314~1254px)을 288px 로 줄였다 (96px 의 3배).
// 번호는 Figma 에셋 이름의 번호다 (01_cropy_시작화면_… 식. 06 은 Figma 에 없다).
// 화면용 13종: 디자인 시스템 "08 · 배경 · 마스코트 · 에셋"에 놓인 그림.
// 피드백 전용 4종: 디자인 시스템 08 에는 없고 화면의 Cropy/FeedbackV3/Mascot/* 에서만 쓰는 그림
const FILES = [
  "greeting", // 01 시작화면 · 반갑게 인사
  "capture-guide", // 02 촬영 안내 · 작물 사진 찍기
  "analyzing", // 03 분석 중 · 돋보기로 잎 확인
  "result", // 04 진단 결과 · 관리 안내 클립보드
  "retake", // 05 재촬영 안내 · 사진 다시 찍기
  "failed", // 07 분석 실패
  "empty", // 08 이력 없음 · 첫 기록 작성
  "saved", // 10 기록 저장 완료 · 노트 작성
  "camera-off", // 11 카메라 꺼짐 · 카메라 켜기 안내
  "photo-ready", // 12 촬영 성공 · 사진 확인 완료
  "comparing", // 14 비교 진단 중 · 후보가 여러 개일 때
  "gallery", // 15 갤러리에서 사진 불러오기
  "help", // 16 도움말·정보 보기
  "confirmation", // 피드백: 이탈·취소를 되묻는다
  "connection", // 피드백: 네트워크·저장·조회 재시도
  "warning", // 피드백: 13 주의 (사진 형식·용량 오류. 병해 확정의 뜻으로 쓰지 않는다)
  "healthy", // 피드백: 09 엄지척 (작업 완료. 건강 판정의 뜻이 아니다)
] as const;

type MascotFile = (typeof FILES)[number];

// 피드백 카드의 이름 중 화면용과 같은 그림을 쓰는 것. Figma 이름 그대로 부를 수 있게 둔다
// (saved·empty 도 피드백과 화면이 같은 그림이고 이름까지 같다)
const ALIASES = {
  analysis: "analyzing",
  photo: "retake",
  info: "help",
} as const satisfies Record<string, MascotFile>;

export type MascotName = MascotFile | keyof typeof ALIASES;

/** 쓸 수 있는 이름 전체 (스토리·테스트용) */
export const MASCOT_NAMES: readonly MascotName[] = [
  ...FILES,
  ...(Object.keys(ALIASES) as (keyof typeof ALIASES)[]),
];

const IMAGE_SIZE = 288;

// 50: 토스트 / 64: 모바일 피드백 카드 / 80: 데스크탑 피드백 카드 / 96: 화면
type MascotSize = 50 | 64 | 80 | 96;

const SIZE: Record<MascotSize, string> = {
  50: "size-[3.125rem]",
  64: "size-16",
  80: "size-20",
  96: "size-24",
};

/** 이름에 해당하는 이미지 경로 */
export function mascotSrc(name: MascotName) {
  const file = Object.hasOwn(ALIASES, name) ? ALIASES[name as keyof typeof ALIASES] : name;
  return `/mascot/${file}.png`;
}

interface MascotProps extends Omit<ComponentPropsWithRef<"img">, "src" | "width" | "height"> {
  name: MascotName;
  size?: MascotSize;
}

/**
 * 상황을 돕는 마스코트 그림. 뜻은 제목·본문·버튼이 전하고 마스코트는 거들 뿐이므로
 * 기본은 장식(alt="")이라 스크린리더가 읽지 않는다. 옆에 글이 없을 때만 alt 를 준다.
 * 크기는 큰글씨 모드에서 글자와 함께 커진다. 정해진 4가지 밖의 크기는 className 에 size-* 로 준다.
 */
export function Mascot({ name, size = 96, alt = "", className, ...rest }: MascotProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 20KB 안팎의 그림이라 next/image 최적화가 필요 없다
    <img
      {...rest}
      src={mascotSrc(name)}
      width={IMAGE_SIZE}
      height={IMAGE_SIZE}
      alt={alt}
      className={cn("shrink-0 object-contain", SIZE[size], className)}
    />
  );
}
