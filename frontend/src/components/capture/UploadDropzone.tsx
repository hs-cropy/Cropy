"use client";

import { useId, useState, type DragEvent, type Ref } from "react";
import { cardClassName } from "@/components/Card";
import { cn } from "@/lib/cn";

interface UploadDropzoneProps {
  /** 끌어다 놓은 파일. 형식·용량 검사는 받는 쪽이 한다 */
  onDropFile: (file: File) => void;
  /** 영역을 누르면 파일 선택 창을 연다 */
  onPick: () => void;
  /** 새 진단 뒤 초점을 받는다 */
  buttonRef?: Ref<HTMLButtonElement>;
  /** 데스크탑 시안(D-01)의 크기를 쓴다. 아니면 모바일 시안(M-01-0) */
  desktop?: boolean;
}

/**
 * 새 진단의 사진 업로드 카드. 사진을 끌어다 놓거나 영역을 눌러 고른다.
 * 데스크탑(D-01 · Upload/Card): 안쪽 24px, 제목 20/28px, 점선 영역 높이 344px·모서리 12px·안쪽 32px,
 * 카메라 아이콘 36px, 안내 24/32px, 형식 14/22px.
 * 모바일(M-01-0 · Upload/PhotoSelection): 카드 높이 320px·안쪽 16px·간격 12px, 제목 18/28px,
 * 점선 영역은 남는 높이(248px)·안쪽 16px·간격 12px, 아이콘 36px, 안내 18/28px, 형식 14/22px 두 줄.
 */
export function UploadDropzone({
  onDropFile,
  onPick,
  buttonRef,
  desktop = true,
}: UploadDropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const titleId = useId();
  const formatId = useId();

  const handleDragOver = (event: DragEvent) => {
    // 기본 동작을 막아야 놓을 수 있고, 브라우저가 사진을 새 탭으로 열지 않는다
    event.preventDefault();
    setDragging(true);
  };

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    // 여러 장을 놓으면 첫 장만 쓴다 (진단은 사진 한 장으로 한다)
    const file = event.dataTransfer.files?.[0];
    if (file) onDropFile(file);
  };

  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        cardClassName({ padding: "none" }),
        desktop ? "flex flex-col gap-4 p-6" : "flex flex-col gap-3 p-4",
      )}
    >
      <h2
        id={titleId}
        className={cn(
          "text-cropy-text-primary",
          desktop ? "text-cropy-heading-md" : "text-cropy-feedback-title leading-7",
        )}
      >
        사진 업로드
      </h2>
      <button
        ref={buttonRef}
        type="button"
        onClick={onPick}
        onDragOver={handleDragOver}
        // 안쪽 아이콘·문구 위를 지날 때도 dragleave 가 오므로 영역 밖으로 나갈 때만 끈다
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setDragging(false);
        }}
        onDrop={handleDrop}
        // 키보드·스크린리더로는 눌러서 고르므로 이름은 하는 일로 짓고, 형식은 설명으로 읽는다
        aria-label="사진 선택하기"
        aria-describedby={formatId}
        className={cn(
          "flex w-full flex-col items-center justify-center rounded-xl border border-dashed text-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cropy-action-primary",
          desktop ? "min-h-[21.5rem] gap-4 p-8" : "min-h-[15.5rem] gap-3 p-4",
          dragging
            ? "border-cropy-action-primary bg-cropy-action-subtle"
            : "border-cropy-border bg-cropy-surface-canvas [@media(hover:hover)]:hover:border-cropy-action-primary",
        )}
      >
        <span aria-hidden className="icon-[lucide--camera] size-9 text-cropy-action-primary" />
        {desktop ? (
          <>
            <span className="break-keep text-cropy-heading-lg text-cropy-text-primary">
              사진을 여기에 놓아주세요
            </span>
            <span id={formatId} className="text-cropy-helper text-cropy-text-secondary">
              JPG, PNG · 최대 100 MB
            </span>
          </>
        ) : (
          <>
            <span className="break-keep text-cropy-feedback-title leading-7 text-cropy-text-primary">
              진단할 사진을 선택해주세요
            </span>
            <span
              id={formatId}
              className="whitespace-pre-line break-keep text-cropy-helper text-cropy-text-secondary"
            >
              {"JPG, PNG 등 최대 100 MB\n(여기를 누르면 사진을 선택할 수 있어요)"}
            </span>
          </>
        )}
      </button>
    </section>
  );
}
