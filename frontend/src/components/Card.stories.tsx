import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { cn } from "@/lib/cn";
import { Badge } from "./Badge";
import { Card, cardClassName } from "./Card";

const meta = {
  title: "공통/Card",
  component: Card,
  tags: ["autodocs"],
  args: { children: "카드 내용", className: "w-[21.375rem]" },
  argTypes: {
    radius: { control: "inline-radio", options: ["md", "lg"] },
    padding: { control: "inline-radio", options: ["none", "md", "lg"] },
  },
  parameters: {
    docs: {
      description: {
        component:
          "디자인 시스템에 독립된 카드 컴포넌트는 없어, `Cropy/V2/History/RecordRow`와 `Cropy/V2/Diagnosis/ResultSummary`의 공통 모양을 뽑았습니다. 안쪽 여백은 창 폭 1024px 부터 웹 값으로 바뀝니다.",
      },
    },
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 모서리 16px·안쪽 16px. 이력 한 줄 같은 작은 카드 */
export const Default: Story = {};

/** 모서리 20px·안쪽 16px(lg 부터 24px). 진단 요약 같은 큰 카드 */
export const Large: Story = {
  args: { radius: "lg", padding: "lg" },
};

/** 여백 없이 내용이 카드 끝까지 닿는다. overflow-hidden 은 쓰는 쪽이 준다 */
export const NoPadding: Story = {
  args: { padding: "none", className: "w-[21.375rem] overflow-hidden" },
  render: (args) => (
    <Card {...args}>
      <div className="bg-cropy-action-subtle px-4 py-2 text-cropy-caption font-bold text-cropy-action-primary">
        AI 진단 결과
      </div>
      <p className="p-4 text-cropy-feedback-body text-cropy-text-primary">고추 탄저병</p>
    </Card>
  ),
};

// button 안에는 div·p 를 넣을 수 없어 span 으로 만든다 (링크·버튼 카드에서도 그대로 쓴다)
function RecordContent() {
  return (
    <>
      <span className="block h-12 w-12 shrink-0 rounded-xl bg-cropy-surface-canvas" />
      <span className="block min-w-0 flex-1 text-left">
        <span className="block text-cropy-feedback-body font-bold text-cropy-text-primary">
          고추 탄저병
        </span>
        <span className="block text-cropy-caption text-cropy-text-secondary">
          고추 · 오늘 오후 2:18
        </span>
      </span>
      <Badge tone="attention" className="shrink-0">
        주의
      </Badge>
    </>
  );
}

/** Figma `Cropy/V2/History/RecordRow` 의 모바일 모양. 배치와 최소 높이는 className 으로 준다 */
export const RecordRow: Story = {
  globals: { viewport: { value: "mobile" } },
  args: { className: "flex min-h-[5.5rem] w-[21.375rem] items-center gap-3" },
  render: (args) => (
    <Card {...args}>
      <RecordContent />
    </Card>
  ),
};

/**
 * 카드 전체가 눌리는 경우. Card 가 아니라 링크·버튼에 `cardClassName({ interactive: true })` 를 준다.
 * Tab 으로 옮기면 초점 표시가 보인다. 버튼 안에는 div·p 를 넣을 수 없으므로 내용을 span 으로 만든다
 */
export const Interactive: Story = {
  render: () => (
    <div className="flex w-[21.375rem] flex-col gap-3">
      <a
        href="#record"
        className={cn(
          cardClassName({ interactive: true }),
          "flex min-h-[5.5rem] items-center gap-3",
        )}
      >
        <RecordContent />
      </a>
      <button
        type="button"
        className={cn(
          cardClassName({ interactive: true }),
          "flex min-h-[5.5rem] w-full items-center gap-3",
        )}
      >
        <RecordContent />
      </button>
    </div>
  ),
};

/** 뜻이 있는 요소(section)에 카드 모양만 입힌다 */
export const AsSection: Story = {
  render: () => (
    <section
      aria-labelledby="card-section-title"
      className={cn(cardClassName({ radius: "lg", padding: "lg" }), "w-[21.375rem]")}
    >
      <h2 id="card-section-title" className="text-cropy-heading-md text-cropy-text-primary">
        관리 방법
      </h2>
      <p className="mt-2 text-cropy-helper text-cropy-text-secondary">
        병든 잎을 따 내고 통풍이 잘 되게 해 주세요.
      </p>
    </section>
  ),
};

/** 내용이 길면 카드가 늘어난다 */
export const LongContent: Story = {
  args: {
    children:
      "지금 관리하면 확산을 줄일 수 있어요. 병든 열매와 잎을 따 내어 밭 밖으로 옮기고, 비가 온 뒤에는 등록된 약제를 살포해 주세요.",
    className: "w-[21.375rem] text-cropy-helper text-cropy-text-secondary",
  },
};
