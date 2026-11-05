"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/** 스크롤이 멈춘 뒤 행동 영역을 다시 보일 때까지 기다리는 시간 */
export const ACTION_DOCK_SHOW_DELAY = 600;
/** 문서 맨 위에서 이만큼 안쪽까지는 숨기지 않는다 */
const TOP_EDGE = 24;
/** 아래로 이만큼 이상 내려야 숨긴다 (그보다 작은 움직임은 쌓아 둔다) */
const MIN_HIDE_DISTANCE = 6;

// 화면 아래에 붙어 있다.
// 전제: 모바일에서는 AppShell 이 아래에 MobileNav(72px + 아래 안전 영역)를 fixed 로 그린다.
// 앱의 모든 화면은 AppFrame 이 늘 내비를 넘기므로 맞지만, 내비 없는 AppShell 에 쓰면 틀이 화면 아래에서
// 내비 높이만큼 떠 보인다 (그때는 아래 오프셋을 내비 유무에 따라 나눠야 한다).
// - 모바일: 내비 바로 위에 fixed 로 붙는다. 내비도 fixed 라 둘이 같은 방식으로
//   화면에 붙어, iOS 사파리의 빠른 스크롤·바운스·도구막대 변화에도 사이가 벌어지지 않는다
//   (sticky 는 그때 문서를 따라 움직여 내비와 어긋났다). 흐름에서 빠진 높이는 앞의 빈 칸(SPACER)이 채운다.
// - lg: 내비가 없으므로 sticky 로 맨 아래에 붙고, 내용이 짧으면 원래 자리(본문 아래)에 있다.
// 틀(DOCK)은 늘 제자리에 있고, 숨길 때는 안쪽(PANEL)만 자기 높이만큼 내려가 틀 아래 끝에서 잘린다.
// 틀 아래 끝이 모바일은 내비 위, lg 는 화면 맨 아래(문서 끝에서는 푸터 위)라 그 뒤로 들어가는 것처럼 보인다.
// lg 에서 틀째 내리면 문서 끝에서 밀려난 만큼 문서 높이가 늘어나 더 스크롤되므로 틀이 넘침을 자른다
// (overflow 는 자기 자신의 sticky 를 깨지 않는다. sticky 는 조상의 스크롤 영역만 본다).
// clip 은 스크롤 상자를 만들지 않아, 숨은 버튼에 Tab 으로 들어갈 때 브라우저가 틀 안쪽을 스크롤해
// 버튼이 어긋나는 일이 없다. clip 을 모르는 Safari 16 미만은 hidden 으로 떨어진다
// (둘을 그냥 나란히 쓰면 cn 이 같은 속성으로 보고 하나만 남기므로 @supports 로 나눈다)
const DOCK =
  "fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 overflow-hidden supports-[overflow:clip]:overflow-clip lg:sticky lg:inset-x-auto lg:bottom-0 print:static print:overflow-visible";
// 모바일에서 fixed 틀이 흐름에서 빠진 만큼 자리를 비워, 본문 끝이 틀 뒤에 가려지지 않게 한다.
// 높이를 재기 전(처음 HTML, JS 가 늦거나 실패할 때)에는 가장 큰 틀 높이(버튼 둘, 9rem = 144px)만큼
// 비워 둔다. 모자라 가리는 것보다 조금 남는 편이 낫다. 재고 나면 style 의 실제 높이가 이 값을 덮는다.
// lg 는 틀이 흐름 안(sticky)이고, 인쇄할 때도 틀이 흐름에 들어가므로(static) 두 번 비우지 않는다
const SPACER = "h-[9rem] lg:hidden print:hidden";
// 동작 줄이기 설정이면 globals.css 가 전환 시간을 없앤다
const PANEL = "transition-transform duration-200 ease-out print:translate-y-0";

// 서버에서는 useLayoutEffect 가 경고를 내므로 useEffect 로 바꿔 쓴다 (서버에서는 어차피 돌지 않는다)
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

interface ActionDockProps {
  children: ReactNode;
}

/**
 * AppShellPage 의 행동 영역(ActionBar)을 화면 아래에 붙여 둔다.
 * 아래로 스크롤하는 동안에는 (문서 끝 근처에서도) 본문을 가리지 않게 아래로 숨고,
 * 스크롤이 멈추거나 위로 올리면 다시 나온다.
 * 안의 버튼에 초점이 있으면 숨기지 않는다 (키보드 사용자가 누르려는 버튼이 사라지지 않게).
 */
export function ActionDock({ children }: ActionDockProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(false);
  // 처음 HTML 에서는 높이를 모르므로 비워 두고(SPACER 의 기본 높이), 화면을 그리기 전에(layout effect) 잰다.
  // 서버와 클라이언트 첫 렌더가 같은 값(null)이라 하이드레이션이 어긋나지 않는다.
  // 숨길 때는 안쪽만 움직이고 틀 높이는 그대로라 빈 칸이 출렁이지 않는다
  const [height, setHeight] = useState<number | null>(null);

  useIsomorphicLayoutEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    // 같은 값이면 React 가 다시 그리지 않는다
    const measure = () => setHeight(frame.offsetHeight);
    measure();

    // 버튼 1개 ↔ 2개, 큰글씨 모드, 폭 변화(lg 경계)에 따라 높이가 바뀐다
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let lastY = window.scrollY;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const show = () => {
      clearTimeout(timer);
      setHidden(false);
    };

    const onScroll = () => {
      // iOS 사파리는 문서 끝을 지나 당기면(바운스) scrollY 가 끝을 넘었다가 되돌아온다.
      // 그 사이를 "아래로 → 위로" 로 읽으면 숨었다가 바로 튀어나오므로, 위치를 끝에서 잘라 읽는다.
      // 끝까지 내린 것은 그대로 아래로 내린 것이 되고, 끝을 넘은 구간은 움직임이 없는 것이 된다.
      // (소수점 스크롤로 끝이 1px 미만 넘치는 것도 함께 잘린다.) clientHeight 는 iOS 에서 확대·키보드에
      // 따라 바뀌는 innerHeight 와 달리 레이아웃 화면 높이라 끝 위치가 흔들리지 않는다
      const root = document.documentElement;
      const max = Math.max(0, root.scrollHeight - root.clientHeight);
      const y = Math.min(window.scrollY, max);

      // 맨 위 근처(위쪽 바운스로 0 보다 작아질 때 포함)에서는 늘 보인다
      if (y <= TOP_EDGE) {
        lastY = Math.max(y, 0);
        show();
        return;
      }

      // 끝이 앞당겨졌다면(내용이 줄거나 도구막대가 접힘) 지난 위치도 새 끝에 맞춘다.
      // 그대로 두면 끝에 머물러 있어도 위로 올린 것으로 읽혀 바로 나온다
      lastY = Math.min(lastY, max);
      const delta = y - lastY;
      if (delta < 0) {
        lastY = y;
        show();
        return;
      }
      // 조금 내린 것(위치가 그대로인 이벤트 포함)은 숨기지 않고 쌓아 둔다. 바운스·도구막대가 접힐 때의
      // 자잘한 움직임에 숨지 않게 한다. 걸어 둔 타이머도 남긴다 (지우면 숨은 채로 다시 나오지 않는다)
      if (delta < MIN_HIDE_DISTANCE) return;
      lastY = y;

      // 초점이 안에 있으면 그대로 둔다 (초점을 받을 때 이미 보이게 한다)
      if (ref.current?.contains(document.activeElement)) return;

      // 스크롤이 이어지는 동안은 다시 나오는 시간을 처음부터 센다
      clearTimeout(timer);
      setHidden(true);
      timer = setTimeout(show, ACTION_DOCK_SHOW_DELAY);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      clearTimeout(timer);
    };
  }, []);

  return (
    <>
      <div
        aria-hidden
        data-action-dock-spacer=""
        className={SPACER}
        style={height == null ? undefined : { height }}
      />
      <div
        ref={ref}
        data-hidden={hidden || undefined}
        onFocusCapture={() => {
          setHidden(false);
          // hidden 으로 떨어진 옛 Safari 에서 초점 이동이 틀 안쪽을 스크롤했으면 되돌린다
          if (ref.current) ref.current.scrollTop = 0;
        }}
        // 숨어 있는 동안 비어 있는 틀이 아래 본문의 누름을 가로채지 않게 한다
        className={cn(DOCK, hidden && "pointer-events-none")}
      >
        <div className={cn(PANEL, hidden && "translate-y-full")}>{children}</div>
      </div>
    </>
  );
}
