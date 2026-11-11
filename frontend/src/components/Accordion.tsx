"use client";

import { useId, useState, type ComponentPropsWithRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface AccordionItem {
  /** 묶음 안에서 겹치지 않는 값 */
  id: string;
  title: ReactNode;
  /** 펼쳤을 때 보이는 내용. 문단(p)을 여럿 넣으면 간격을 띄운다 */
  content: ReactNode;
}

// 화면의 FixedMobile/DiagnosisDetails 와 Desktop/DiagnosisDetails.
// 항목: 흰 배경·테두리·모서리 16px, 항목 사이 8px
const ITEM = "overflow-hidden rounded-2xl border border-cropy-border bg-cropy-surface";

// 머리: 좌우 16px·상하 12px·15px Bold → lg 안쪽 16px·최소 56px·16px Bold.
// Figma(M-03-E1)의 머리는 펼쳐도 항목과 같은 흰 배경이다. 터치 기기에서 누름 배경을 주면
// 머리만 회색 띠로 남아 어색하므로, 호버·누름 배경은 마우스 기기에만 준다.
// 초점 표시는 항목의 overflow-hidden 에 잘리지 않게 안쪽으로 그린다
const TRIGGER =
  "flex w-full cursor-pointer items-center gap-3 break-keep px-4 py-3 text-left text-cropy-feedback-body font-bold text-cropy-text-primary [overflow-wrap:break-word] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cropy-action-primary lg:min-h-14 lg:gap-4 lg:py-4 lg:text-cropy-body-lg lg:font-bold [@media(hover:hover)]:hover:bg-cropy-surface-canvas";

// 본문: 좌우 16px·아래 18px·문단 간격 12px·14px → lg 아래 20px·간격 8px
const PANEL =
  "flex flex-col gap-3 break-keep px-4 pb-[1.125rem] text-cropy-helper text-cropy-text-secondary [overflow-wrap:break-word] lg:gap-2 lg:pb-5";

interface AccordionProps extends Omit<ComponentPropsWithRef<"div">, "defaultValue"> {
  items: AccordionItem[];
  /**
   * 펼친 항목의 id. 모두 닫혔으면 null. 주면 상태를 쓰는 쪽이 갖는다.
   * 닫을 때는 undefined 가 아니라 null 을 준다 (undefined 면 안쪽 상태로 돌아간다)
   */
  value?: string | null;
  /** 처음에 펼칠 항목 (value 를 주지 않을 때) */
  defaultValue?: string | null;
  onValueChange?: (value: string | null) => void;
  /** 머리를 감싸는 제목의 수준. 놓이는 화면의 제목 순서에 맞춘다 */
  headingLevel?: 2 | 3 | 4;
}

/**
 * 한 번에 하나만 펼치는 목록. 펼친 항목을 다시 누르면 닫히고, 다른 항목을 누르면 그 항목만 펼친다.
 * 닫힌 내용은 화면에도 스크린리더에도 없다. 펼침에 애니메이션은 없다.
 * 다른 기록으로 넘어갈 때 펼침을 되돌리려면 key 를 바꾸거나 value 를 null 로 준다.
 * 묶음 위의 "상세 정보" 같은 제목은 쓰는 쪽이 둔다.
 */
export function Accordion({
  items,
  value,
  defaultValue = null,
  onValueChange,
  headingLevel = 3,
  className,
  ...rest
}: AccordionProps) {
  const baseId = useId();
  const [inner, setInner] = useState<string | null>(defaultValue);
  const open = value !== undefined ? value : inner;
  const Heading = `h${headingLevel}` as const;

  const toggle = (id: string) => {
    const next = open === id ? null : id;
    if (value === undefined) setInner(next);
    onValueChange?.(next);
  };

  return (
    <div {...rest} className={cn("flex flex-col gap-2", className)}>
      {items.map((item, index) => {
        const expanded = open === item.id;
        // item.id 에 공백이 있으면 aria-controls 가 끊기므로 DOM id 는 순서로 만든다
        const triggerId = `${baseId}-${index}-trigger`;
        const panelId = `${baseId}-${index}-panel`;

        return (
          <div key={item.id} className={ITEM}>
            <Heading>
              <button
                type="button"
                id={triggerId}
                aria-expanded={expanded}
                aria-controls={panelId}
                className={TRIGGER}
                onClick={() => toggle(item.id)}
              >
                <span className="min-w-0 flex-1">{item.title}</span>
                <span
                  aria-hidden
                  className={cn(
                    "icon-[lucide--chevron-down] h-5 w-5 shrink-0 text-cropy-text-secondary",
                    expanded && "rotate-180",
                  )}
                />
              </button>
            </Heading>
            <div
              id={panelId}
              role="region"
              aria-labelledby={triggerId}
              hidden={!expanded}
              className={expanded ? PANEL : undefined}
            >
              {expanded && item.content}
            </div>
          </div>
        );
      })}
    </div>
  );
}
