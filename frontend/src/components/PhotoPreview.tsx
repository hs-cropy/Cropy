"use client";

import { useState } from "react";

import { cn } from "@/lib/cn";

/**
 * Mount with key={src} so selecting another photo resets decoder failure state.
 * fallbackClassName sizes the filename notice to the box it replaces the photo in.
 */
export function PhotoPreview({ src, alt, className, fileName, fallbackClassName = "min-h-48 h-full pb-12" }: {
  src: string; alt: string; className?: string; fileName?: string; fallbackClassName?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span role="status" className={cn("flex flex-col items-center justify-center gap-2 px-6 text-center text-cropy-text-secondary", fallbackClassName)}>
        <span className="font-semibold text-cropy-text-primary">사진이 선택됐어요</span>
        {fileName && <span className="max-w-full break-all">{fileName}</span>}
        <span>이 사진은 진단이 끝나면 확인할 수 있어요.</span>
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} onError={() => setFailed(true)} />;
}
