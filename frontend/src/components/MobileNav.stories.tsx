import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { MobileNav } from "./MobileNav";
import type { NavItem } from "./navItem";

// 실제 경로는 화면에 붙일 때 정한다. 여기서는 모양만 본다
const ITEMS: NavItem[] = [
  {
    key: "capture",
    href: "#capture",
    label: "새 진단",
    mobileLabel: "촬영",
    icon: "icon-[lucide--camera]",
  },
  {
    key: "result",
    href: "#result",
    label: "진단 결과",
    mobileLabel: "진단",
    icon: "icon-[lucide--scan-search]",
  },
  {
    key: "history",
    href: "#history",
    label: "진단 이력",
    mobileLabel: "이력",
    icon: "icon-[lucide--history]",
  },
];

const meta = {
  title: "공통/MobileNav",
  component: MobileNav,
  tags: ["autodocs"],
  args: { items: ITEMS },
  argTypes: {
    current: { control: "inline-radio", options: ["capture", "result", "history"] },
  },
  // 모바일 화면에 쓰는 컴포넌트라 모바일 폭에서 본다
  globals: { viewport: { value: "mobile" } },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof MobileNav>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Figma `Cropy/V2/Navigation/Mobile` Selected=Capture */
export const Capture: Story = {
  args: { current: "capture" },
};

/** Selected=Diagnosis */
export const Diagnosis: Story = {
  args: { current: "result" },
};

/** Selected=History */
export const History: Story = {
  args: { current: "history" },
};

/** 현재 화면이 내비에 없는 경우 (예: 상세 화면) */
export const NoneSelected: Story = {};

/** 라벨이 길어도 어절 단위로 나뉘고 항목 폭은 똑같다 */
export const LongLabel: Story = {
  args: {
    current: "result",
    items: [
      { ...ITEMS[0], mobileLabel: "사진 새로 찍기" },
      { ...ITEMS[1], mobileLabel: "진단 결과 보기" },
      ITEMS[2],
    ],
  },
};

/** 화면 아래에 놓인 모습. 본문만 스크롤하고 내비는 제자리에 있다 */
export const OnScreen: Story = {
  args: { current: "history" },
  decorators: [
    (Story) => (
      <div className="flex h-[52.75rem] flex-col bg-cropy-surface-canvas">
        <div className="flex-1 space-y-3 overflow-y-auto p-6 text-cropy-body-lg text-cropy-text-secondary">
          {Array.from({ length: 24 }, (_, index) => (
            <p key={index}>본문 {index + 1}번째 줄</p>
          ))}
        </div>
        <Story />
      </div>
    ),
  ],
};
