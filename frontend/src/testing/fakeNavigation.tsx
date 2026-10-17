import { useSyncExternalStore, type ReactNode } from "react";

/**
 * 테스트용 Next 라우터. 경로·기록을 메모리에 두고 usePathname·useRouter 를 흉내 낸다.
 * vi.mock("next/navigation", async () => (await import("@/testing/fakeNavigation")).nextNavigation)
 * 처럼 쓰고, 경로마다 화면을 바꿔 그리려면 <FakeRoutes routes={...} /> 를 쓴다.
 */
let entries: string[] = ["/"];
let index = 0;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function pathOf(href: string) {
  return new URL(href, "http://localhost").pathname;
}

export const fakeRouter = {
  push: (href: string) => {
    entries = [...entries.slice(0, index + 1), pathOf(href)];
    index = entries.length - 1;
    notify();
  },
  replace: (href: string) => {
    entries = entries.map((entry, i) => (i === index ? pathOf(href) : entry));
    notify();
  },
  back: () => {
    if (index === 0) return;
    index -= 1;
    notify();
  },
  forward: () => {
    if (index >= entries.length - 1) return;
    index += 1;
    notify();
  },
  refresh: () => {},
  prefetch: () => {},
};

export const fakeNavigation = {
  get pathname() {
    return entries[index];
  },
  /** 새 기록 하나로 처음부터 시작한다 (테스트 사이에 부른다) */
  reset(pathname = "/") {
    entries = [pathname];
    index = 0;
    notify();
  },
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function usePathname() {
  return useSyncExternalStore(
    subscribe,
    () => entries[index],
    () => entries[index],
  );
}

function useRouter() {
  return fakeRouter;
}

/** 앱의 동적 경로는 이력 상세(/history/[id]) 하나뿐이라 그 id 만 꺼낸다 */
function useParams() {
  const match = usePathname().match(/^\/history\/([^/]+)$/);
  return match ? { id: decodeURIComponent(match[1]) } : {};
}

export const nextNavigation = { usePathname, useRouter, useParams };

/** 지금 경로에 맞는 화면을 그린다 (앱의 app/ 폴더 대신) */
export function FakeRoutes({ routes }: { routes: Record<string, ReactNode> }) {
  const pathname = usePathname();
  return <>{routes[pathname] ?? null}</>;
}

/**
 * 테스트용 next/link: 보통 링크처럼 그리고, 앱의 onClick 이 막지 않은 그냥 클릭이면 가짜 라우터로 옮긴다.
 * vi.mock("next/link", async () => ({ default: (await import("@/testing/fakeNavigation")).FakeLink }))
 */
export function FakeLink({
  href,
  onClick,
  children,
  // a 요소에 넘기지 않으려고 빼낸다
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  prefetch: _prefetch,
  ...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean }) {
  return (
    <a
      {...rest}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        const plain =
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey;
        if (event.defaultPrevented || !plain) return;
        event.preventDefault();
        fakeRouter.push(href);
      }}
    >
      {children}
    </a>
  );
}
