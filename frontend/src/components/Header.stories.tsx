import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Header } from "./Header";
import { MobileNav } from "./MobileNav";
import type { NavItem } from "./navItem";
import { Switch } from "./Switch";

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

// 큰 글자·음성 스위치. 넓은 데스크탑(xl)에서는 Figma 의 고정 폭(112px, 132px)을 쓴다
function Switches() {
  const [large, setLarge] = useState(false);
  const [voice, setVoice] = useState(false);
  return (
    <>
      <Switch checked={large} onCheckedChange={setLarge} className="xl:w-28">
        큰 글자
      </Switch>
      <Switch
        checked={voice}
        onCheckedChange={setVoice}
        aria-label="음성 안내"
        className="xl:w-[8.25rem]"
      >
        <span className="md:hidden">음성</span>
        <span className="hidden md:inline">음성 안내</span>
      </Switch>
    </>
  );
}

const meta = {
  title: "공통/Header",
  component: Header,
  tags: ["autodocs"],
  args: { items: ITEMS, homeHref: "#home", actions: <Switches /> },
  argTypes: {
    current: { control: "inline-radio", options: ["capture", "result", "history"] },
    actions: { control: false },
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Header>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Figma `Cropy/V2/Mobile/Header`. 내비는 하단 내비가 대신하므로 보이지 않는다.
 * 문서(Docs) 탭은 화면 폭 설정을 따르지 않아 데스크탑 모양으로 보인다. 스토리를 열어서 본다
 */
export const Mobile: Story = {
  args: { current: "capture" },
  globals: { viewport: { value: "mobile" } },
};

/** Figma `Cropy/V2/Desktop/Header/촬영` */
export const DesktopCapture: Story = {
  args: { current: "capture" },
  globals: { viewport: { value: "desktop" } },
};

/** `Cropy/V2/Desktop/Header/진단` */
export const DesktopDiagnosis: Story = {
  args: { current: "result" },
  globals: { viewport: { value: "desktop" } },
};

/** `Cropy/V2/Desktop/Header/이력` */
export const DesktopHistory: Story = {
  args: { current: "history" },
  globals: { viewport: { value: "desktop" } },
};

/** Figma 에 없는 폭(768px). 내비가 들어갈 자리가 없어 모바일 모양을 쓴다 */
export const Tablet: Story = {
  args: { current: "result" },
  globals: { viewport: { value: "tablet" } },
};

/** Figma 에 없는 폭(1024px). 여백과 간격을 줄인 데스크탑 모양이고 큰글씨를 켜도 넘치지 않는다 */
export const SmallDesktop: Story = {
  args: { current: "result" },
  globals: { viewport: { value: "smallDesktop" } },
};

/** 로고와 스위치만 있는 헤더 */
export const WithoutNav: Story = {
  args: { items: [] },
  globals: { viewport: { value: "desktop" } },
};

/** 모바일 화면 전체. 헤더와 하단 내비는 제자리에 있고 본문만 스크롤한다 */
export const MobileScreen: Story = {
  args: { current: "history" },
  globals: { viewport: { value: "mobile" } },
  render: (args) => (
    <div className="flex h-[52.75rem] flex-col bg-cropy-surface-canvas">
      <Header {...args} />
      <main className="flex-1 space-y-3 overflow-y-auto px-6 text-cropy-body-lg text-cropy-text-secondary">
        {Array.from({ length: 24 }, (_, index) => (
          <p key={index}>본문 {index + 1}번째 줄</p>
        ))}
      </main>
      <MobileNav items={args.items ?? []} current={args.current} className="lg:hidden" />
    </div>
  ),
};
