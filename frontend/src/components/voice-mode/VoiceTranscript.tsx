"use client";

import { useEffect, useRef, useState } from "react";
import type { VoiceTurn } from "@/features/voice/hooks/useVoiceConversation";

interface VoiceTranscriptProps {
  turns: VoiceTurn[];
  className?: string;
}

/**
 * 이번 음성 모드에서 주고받은 말. 말풍선 대신 한 줄씩 가볍게 쌓아 작은 화면에서도 읽힌다.
 * 밭에서 소리가 잘 안 들려도 눈으로 확인하는 용도라 최신이 아래에 오고 자동으로 내려간다.
 */
export function VoiceTranscript({ turns, className = "" }: VoiceTranscriptProps) {
  // 기본은 접힌 상태: 마지막 말 한 줄만 보여 카메라·마이크 자리를 남긴다. 눌러서 펼친다
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, open]);

  if (turns.length === 0) return null;
  const last = turns[turns.length - 1];

  return (
    <section aria-label="대화 기록" className={`w-full rounded-2xl border border-[#E2EBE4] bg-white/85 text-left ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left"
      >
        <span className="shrink-0 text-xs font-semibold text-[#647267]">대화 기록 {turns.length}</span>
        {!open && (
          <span className="min-w-0 flex-1 truncate text-xs text-[#3B4A3F]">
            <span className="text-[#8C7B54]">{last.role === "user" ? "나" : "크로피"}</span> {last.text}
          </span>
        )}
        <span
          aria-hidden="true"
          className={`ml-auto h-4 w-4 shrink-0 text-[#647267] ${open ? "icon-[lucide--chevron-up]" : "icon-[lucide--chevron-down]"}`}
        />
      </button>
      {open && (
      <ol ref={listRef} role="log" className="max-h-[22dvh] space-y-1.5 overflow-y-auto border-t border-[#EEF3EF] px-3 py-2 lg:max-h-44">
        {turns.map((turn, i) => {
          const user = turn.role === "user";
          return (
            <li key={i} className="flex gap-2 text-sm leading-snug">
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  user ? "bg-[#E5F4E6] text-[#1F6B3B]" : "bg-[#25864F] text-white"
                }`}
              >
                {user ? "나" : "크"}
              </span>
              <span className="sr-only">{user ? "내 말" : "크로피"}</span>
              <p className={`min-w-0 flex-1 whitespace-pre-line ${user ? "text-[#212A23]" : "text-[#3B4A3F]"}`}>{turn.text}</p>
            </li>
          );
        })}
      </ol>
      )}
    </section>
  );
}
