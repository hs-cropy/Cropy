import type { ComponentPropsWithRef } from "react";
import { Button } from "@/components/Button";
import { InlineFeedback } from "@/components/InlineFeedback";
import { FEEDBACK, type FeedbackCaseId } from "./cases";

interface CaseFeedbackProps extends Omit<
  ComponentPropsWithRef<typeof InlineFeedback>,
  "mascot" | "title" | "children" | "actions" | "tone"
> {
  /** 문구 사전의 케이스 ID (Figma 의 Cropy/FeedbackV3/inline/{ID}) */
  caseId: FeedbackCaseId;
  /** 버튼이 있는 케이스에는 할 일을 꼭 넘긴다 (안 넘기면 눌러도 아무 일이 없는 버튼이 된다) */
  onPrimary?: () => void;
  onSecondary?: () => void;
  /**
   * 주 버튼의 일을 하는 중. 다시 누를 수 없게 막는다.
   * 라벨은 바꾸지 않는다: alert 안의 글이 바뀌면 안내 전체가 다시 읽힐 수 있다
   */
  primaryLoading?: boolean;
}

/**
 * 문구 사전의 안내를 그대로 보여 준다. 어떤 오류에 어떤 케이스를 쓸지와 버튼이 할 일은
 * 쓰는 화면이 정한다. 사전에 없는 문구가 필요하면 InlineFeedback 을 직접 쓴다.
 */
export function CaseFeedback({
  caseId,
  onPrimary,
  onSecondary,
  primaryLoading = false,
  ...rest
}: CaseFeedbackProps) {
  const { mascot, title, message, primary, secondary, busy } = FEEDBACK[caseId];

  return (
    <InlineFeedback
      {...rest}
      mascot={mascot}
      title={title}
      tone={busy ? "status" : "alert"}
      actions={
        primary ? (
          <>
            <Button size="compact" loading={primaryLoading} onClick={onPrimary}>
              {primary}
            </Button>
            {secondary && (
              <Button size="compact" variant="secondary" onClick={onSecondary}>
                {secondary}
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      {message}
    </InlineFeedback>
  );
}
