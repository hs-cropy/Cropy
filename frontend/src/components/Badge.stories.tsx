import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Badge } from "./Badge";

const meta = {
  title: "공통/Badge",
  component: Badge,
  tags: ["autodocs"],
  args: { tone: "attention", children: "위험" },
  argTypes: {
    tone: { control: "inline-radio", options: ["attention", "low", "action"] },
    variant: { control: "inline-radio", options: ["pill", "cell"] },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Figma `Cropy/V2/Badge/Status` Status=위험 */
export const Danger: Story = {};

/** Status=주의. 위험과 같은 색이고 라벨로만 구분한다 */
export const Caution: Story = {
  args: { children: "주의" },
};

/** Status=낮음 */
export const Low: Story = {
  args: { tone: "low", children: "낮음" },
};

/** Status=재촬영. 위험 등급이 아니라 분석 상태다 */
export const Recapture: Story = {
  args: { tone: "action", children: "재촬영" },
};

/** 데스크탑 이력 테이블의 등급 칸. 폭 72px·모서리 8px·13px */
export const Cell: Story = {
  args: { variant: "cell", children: "주의" },
};

/** 디자인 시스템의 고정 폭(72px) 알약. 폭은 className 으로 준다 */
export const FixedWidth: Story = {
  args: { className: "w-[4.5rem]", children: "주의" },
};

/** 이력 카드에 놓인 모습 */
export const InCard: Story = {
  render: () => (
    <div className="flex w-[21.375rem] items-center gap-3 rounded-2xl border border-cropy-border bg-cropy-surface p-4">
      <div className="h-12 w-12 shrink-0 rounded-xl bg-cropy-surface-canvas" />
      <div className="min-w-0 flex-1">
        <p className="text-cropy-feedback-body font-bold text-cropy-text-primary">고추 탄저병</p>
        <p className="text-cropy-caption text-cropy-text-secondary">고추 · 오늘 오후 2:18</p>
      </div>
      <Badge tone="attention" className="shrink-0">
        주의
      </Badge>
    </div>
  ),
};

/** 종류와 모양을 한눈에 본다 */
export const AllVariants: Story = {
  render: () => (
    <div className="grid w-fit grid-cols-[auto_repeat(4,auto)] items-center justify-items-start gap-3 text-cropy-caption text-cropy-text-secondary">
      <span>pill</span>
      <Badge tone="attention">위험</Badge>
      <Badge tone="attention">주의</Badge>
      <Badge tone="low">낮음</Badge>
      <Badge tone="action">재촬영</Badge>
      <span>cell</span>
      <Badge tone="attention" variant="cell">
        위험
      </Badge>
      <Badge tone="attention" variant="cell">
        주의
      </Badge>
      <Badge tone="low" variant="cell">
        낮음
      </Badge>
      <Badge tone="action" variant="cell">
        재촬영
      </Badge>
    </div>
  ),
};
