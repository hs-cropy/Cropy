"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ActionBar } from "@/components/ActionBar";
import { Button } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import type { MascotName } from "@/components/Mascot";
import { DESKTOP_QUERY, useMediaQuery } from "@/hooks/useMediaQuery";
import type { DiagnoseResponse } from "@/types/diagnosis";
import { DiagnosisAnalyzing } from "./DiagnosisAnalyzing";
import { DiagnosisEmptyState } from "./DiagnosisEmptyState";
import { DiagnosisResultView, resultTimeSentence } from "./DiagnosisResultView";

type View = "empty" | "analyzing" | "result" | "restoring" | "exception";

interface ScreenCopy {
  title: string;
  description: string;
  mascot?: MascotName;
}

// Figma 03 · 분석 진행 · 진단 결과. 데스크탑 결과의 설명은 진단 시각으로 만든다 (아래)
type CopyView = Exclude<View, "exception" | "restoring">;

const MOBILE_COPY: Record<CopyView, ScreenCopy> = {
  empty: {
    title: "진단 시작",
    description: "사진을 찍거나 선택하면\n진단 결과와 관리 방법을 볼 수 있어요.",
  },
  analyzing: {
    title: "사진 분석 중",
    description: "작물과 증상을 확인하고 있어요.\n잠시만 기다려주세요.",
    mascot: "analyzing",
  },
  result: {
    title: "진단 결과",
    description: "진단 요약을 확인하고\n필요한 상세 정보를 펼쳐보세요.",
    mascot: "result",
  },
};

const DESKTOP_COPY: Record<CopyView, ScreenCopy> = {
  empty: {
    title: "진단 시작",
    description: "사진을 입력하면 이곳에서 분석 결과와 관리 방법을 확인할 수 있어요.",
  },
  analyzing: {
    title: "사진을 분석하고 있어요",
    description: "사진에 나타난 작물과 증상을 함께 살펴보고 있어요.",
    mascot: "analyzing",
  },
  result: {
    title: "진단 결과",
    description: "진단 요약을 확인하고, 아래 관리 방법을 참고해주세요.",
    mascot: "result",
  },
};

/** 초점이 없거나 숨긴 곳(눌렀던 버튼이 사라진 자리 등)에 남아 있는지 */
function focusLost() {
  const active = document.activeElement;
  return !active || active === document.body || Boolean(active.closest("[hidden], .hidden"));
}

export interface DiagnosisScreenProps {
  result: DiagnoseResponse | null;
  loading: boolean;
  /** "분석 취소"를 누르고 촬영 화면으로 돌아가는 중 (그 사이 빈 화면이 잠깐 보이지 않게 한다) */
  cancelling?: boolean;
  /** 새로고침 뒤 마지막 결과를 다시 불러오는 중 */
  restoring?: boolean;
  /** 고른 사진의 미리보기 주소 */
  photo: string | null;
  /** 실패·저신뢰·재촬영 같은 예외 화면. 있으면 제목·버튼 없이 이것만 그린다 */
  exception?: ReactNode;
  onSaved?: (result: DiagnoseResponse) => void;
  onCancel: () => void;
  onNewDiagnosis: () => void;
  /** 진단 시작 안내의 "사진 찍기"(모바일)·"카메라로 촬영"(데스크탑) */
  onShoot: () => void;
  /** 진단 시작 안내의 "갤러리에서 선택"(모바일)·"사진 선택하기"(데스크탑) */
  onPickGallery: () => void;
  /** 진단 시작 안내의 "촬영 방법 보기": 촬영 화면의 촬영 가이드를 연다 */
  onOpenGuide: () => void;
}

export interface DiagnosisScreenParts {
  header: ReactNode;
  body: ReactNode;
  actions: ReactNode;
}

export interface DiagnosisScreenHandle extends DiagnosisScreenParts {
  /**
   * 화면 아래 행동 영역에 버튼이 있는지 (토스트를 그 위에 띄운다). 예외 화면의 패널은 버튼을
   * 행동 영역으로 보낸다
   */
  hasActions: boolean;
  /** 화면 제목으로 초점을 옮긴다 (촬영 화면에서 넘어왔을 때) */
  focusTitle: () => void;
}

/**
 * 진단 결과 화면 /diagnosis (Figma 03 · 분석 진행 · 진단 결과): 진단 시작 안내, 사진 분석 중, 진단 결과.
 * 촬영 화면(useCaptureScreen)처럼 제목·본문·버튼을 조각으로 돌려주고, 쓰는 쪽이 AppShellPage 의
 * 각 자리에 넣는다. 예외 화면(실패·저신뢰·재촬영)은 각 패널이 제목과 버튼을 갖는다.
 */
export function useDiagnosisScreen({
  result,
  loading,
  cancelling = false,
  restoring = false,
  photo,
  exception,
  onSaved,
  onCancel,
  onNewDiagnosis,
  onShoot,
  onPickGallery,
  onOpenGuide,
}: DiagnosisScreenProps): DiagnosisScreenHandle {
  const desktopMatch = useMediaQuery(DESKTOP_QUERY);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const view: View =
    loading || cancelling
      ? "analyzing"
      : exception
        ? "exception"
        : result
          ? "result"
          : restoring
            ? "restoring"
            : "empty";
  // 모바일의 분석 중·결과는 버튼을 본문 안에 둔다
  const hasActions =
    view === "exception" || view === "empty" || (desktopMatch === true && view !== "restoring");

  // 누른 버튼이 화면 전환으로 사라지면(이 사진으로 진단하기 → 분석 중 → 결과) 초점이 body 로
  // 빠진다. 그때는 새 화면의 제목으로 옮겨 바뀐 화면을 읽게 한다
  const previousViewRef = useRef(view);
  useEffect(() => {
    const previous = previousViewRef.current;
    previousViewRef.current = view;
    // 새로고침 뒤 결과를 다시 불러온 것은 사용자 동작이 아니라 옮기지 않는다 (제목에 초점 테두리가 생긴다)
    if (previous === view || previous === "restoring" || view === "restoring") return;
    if (focusLost()) titleRef.current?.focus({ preventScroll: true });
  }, [view]);
  const focusTitle = () => titleRef.current?.focus({ preventScroll: true });

  const renderParts = (
    desktop: boolean,
    {
      actionsClassName,
      lazyMascot = false,
    }: { actionsClassName?: string; lazyMascot?: boolean } = {},
  ): DiagnosisScreenParts => {
    if (view === "exception") return { header: null, body: exception, actions: null };

    // 다시 불러오는 동안은 결과 화면의 제목을 먼저 보인다
    const copy = (desktop ? DESKTOP_COPY : MOBILE_COPY)[view === "restoring" ? "result" : view];
    const description =
      view === "result" && desktop && result
        ? (resultTimeSentence(result.created_at) ?? copy.description)
        : copy.description;

    const header = (
      <PageHeader
        title={copy.title}
        description={description}
        mascot={copy.mascot}
        mascotLoading={lazyMascot ? "lazy" : undefined}
        titleRef={titleRef}
      />
    );

    const body =
      view === "analyzing" ? (
        <DiagnosisAnalyzing
          photo={photo}
          onCancel={onCancel}
          cancelling={cancelling}
          desktop={desktop}
        />
      ) : view === "result" && result ? (
        <DiagnosisResultView
          result={result}
          photo={photo}
          onSaved={onSaved}
          onNewDiagnosis={onNewDiagnosis}
          desktop={desktop}
        />
      ) : view === "restoring" ? (
        <p
          role="status"
          className="flex items-center justify-center gap-2 py-10 text-cropy-body-lg text-cropy-text-secondary"
        >
          <span
            aria-hidden
            className="icon-[lucide--loader-circle] size-5 text-cropy-action-primary motion-safe:animate-spin"
          />
          마지막 진단 결과를 불러오고 있어요
        </p>
      ) : (
        <DiagnosisEmptyState desktop={desktop} onOpenGuide={onOpenGuide} />
      );

    // 화면마다 key 로 새 요소를 만들어, 누른 버튼의 초점이 다른 이름의 버튼(분석 취소 → 새 진단)에
    // 그대로 남지 않고 새 화면의 제목으로 옮겨 가게 한다
    const actions =
      view === "empty" ? (
        <ActionBar
          key={`diagnosis-${view}-${desktop ? "wide" : "mobile"}`}
          className={actionsClassName}
        >
          {desktop ? (
            <>
              <Button type="button" onClick={onPickGallery}>
                사진 선택하기
              </Button>
              <Button type="button" variant="secondary" onClick={onShoot}>
                카메라로 촬영
              </Button>
            </>
          ) : (
            <>
              <Button type="button" onClick={onShoot}>
                사진 찍기
              </Button>
              <Button type="button" variant="secondary" onClick={onPickGallery}>
                갤러리에서 선택
              </Button>
            </>
          )}
        </ActionBar>
      ) : desktop && view === "analyzing" ? (
        <ActionBar
          key={`diagnosis-${view}-${desktop ? "wide" : "mobile"}`}
          className={actionsClassName}
        >
          <Button type="button" variant="secondary" disabled={cancelling} onClick={onCancel}>
            분석 취소
          </Button>
        </ActionBar>
      ) : desktop && view === "result" ? (
        <ActionBar
          key={`diagnosis-${view}-${desktop ? "wide" : "mobile"}`}
          className={actionsClassName}
        >
          <Button type="button" onClick={onNewDiagnosis}>
            새 진단
          </Button>
        </ActionBar>
      ) : null;

    return { header, body, actions };
  };

  // 서버 렌더·하이드레이션 때는 폭을 모른다. 두 벌을 그리고 CSS 로 하나만 보인다 (촬영 화면과 같다)
  if (desktopMatch === null) {
    const mobile = renderParts(false, { actionsClassName: "lg:hidden", lazyMascot: true });
    const wide = renderParts(true, { actionsClassName: "hidden lg:flex", lazyMascot: true });
    if (view === "exception") return { ...mobile, hasActions, focusTitle };
    return {
      hasActions,
      focusTitle,
      header: (
        <>
          <div className="lg:hidden">{mobile.header}</div>
          <div className="hidden lg:block">{wide.header}</div>
        </>
      ),
      body: (
        <>
          <div className="lg:hidden">{mobile.body}</div>
          <div className="hidden lg:block">{wide.body}</div>
        </>
      ),
      actions: (
        <>
          {mobile.actions}
          {wide.actions}
        </>
      ),
    };
  }

  return { ...renderParts(desktopMatch), hasActions, focusTitle };
}
