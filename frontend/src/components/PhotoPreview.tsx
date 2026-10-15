"use client";

import { useState } from "react";

/** Mount with key={src} so selecting another photo resets decoder failure state. */
export function PhotoPreview({ src, alt, className, fileName }: {
  src: string; alt: string; className?: string; fileName?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span role="status" className="flex min-h-48 h-full flex-col items-center justify-center gap-2 px-6 pb-12 text-center text-cropy-text-secondary">
        <span className="font-semibold text-cropy-text-primary">사진이 선택됐어요</span>
        <span className="max-w-full break-all">{fileName}</span>
        <span>이 사진은 진단이 끝나면 확인할 수 있어요.</span>
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} onError={() => setFailed(true)} />;
}
