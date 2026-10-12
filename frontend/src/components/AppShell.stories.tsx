import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Accordion } from "./Accordion";
import { ActionBar } from "./ActionBar";
import { AppShell, AppShellFooter, AppShellPage } from "./AppShell";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Card } from "./Card";
import { Header } from "./Header";
import { Mascot } from "./Mascot";
import { MobileNav } from "./MobileNav";
import type { NavItem } from "./navItem";
import { PageHeader } from "./PageHeader";
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

// Figma 화면의 헤더는 농장 배경이 비치도록 배경색이 없다
function Shell({ current, children }: { current: string; children: React.ReactNode }) {
  return (
    <AppShell
      header={
        <Header
          items={ITEMS}
          current={current}
          homeHref="#home"
          actions={<Switches />}
          className="bg-transparent lg:bg-transparent"
        />
      }
      nav={<MobileNav items={ITEMS} current={current} />}
      footer={<AppShellFooter />}
    >
      {children}
    </AppShell>
  );
}

const DETAILS = [
  {
    id: "symptom",
    title: "증상",
    content: <p>주로 열매에 둥글고 움푹 팬 갈색 병반이 생깁니다.</p>,
  },
  { id: "cause", title: "원인", content: <p>비가 잦고 습한 날씨에 빗물과 함께 퍼집니다.</p> },
  { id: "prevention", title: "예방법", content: <p>병든 열매와 잔재를 밭 밖으로 치워주세요.</p> },
  { id: "pesticide", title: "등록 농약", content: <p>등록 약제를 안전사용기준에 맞게 쓰세요.</p> },
];

const meta = {
  title: "공통/AppShell",
  component: AppShell,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "앱의 고정 틀입니다. `AppShell`(헤더·내비·푸터·농장 배경)은 레이아웃에 한 번 놓고, 화면은 `AppShellPage`(제목 영역·스크롤되는 본문·행동 영역)를 그립니다. 본문만 스크롤됩니다. 모바일 390×844: 헤더 76 / 제목 112 / 본문 / 행동 영역 0·84·144 / 내비 72. 데스크탑 1440×960: 헤더 80 / 제목 160 / 본문 / 행동 영역 80 / 푸터 64. 스토리를 열어서 확인하세요 (문서 탭에서는 높이가 맞지 않습니다).",
      },
    },
  },
  globals: { viewport: { value: "mobile" } },
} satisfies Meta<typeof AppShell>;

export default meta;
type Story = StoryObj<typeof meta>;

function StartScreen() {
  return (
    <Shell current="result">
      <AppShellPage
        header={
          <PageHeader
            title="진단 시작"
            description={"사진을 찍거나 선택하면\n진단 결과와 관리 방법을 볼 수 있어요."}
          />
        }
        actions={
          <ActionBar>
            <Button>사진 찍기</Button>
            <Button variant="secondary">갤러리에서 선택</Button>
          </ActionBar>
        }
      >
        <div className="flex flex-col items-center gap-4 text-center">
          <Mascot name="greeting" />
          <p className="break-keep text-[1.75rem] font-bold leading-9 tracking-[-0.015em] text-cropy-text-primary">
            사진으로 작물 상태를 확인해보세요
          </p>
          <p className="break-keep text-cropy-feedback-body text-cropy-text-secondary">
            작물 사진을 찍거나 갤러리에서 선택하면 진단 결과와 관리 방법을 확인할 수 있어요.
          </p>
        </div>
        <p className="text-cropy-caption text-cropy-text-secondary">
          지난 진단은 이력에서 확인할 수 있어요.
        </p>
      </AppShellPage>
    </Shell>
  );
}

function ResultScreen() {
  return (
    <Shell current="result">
      <AppShellPage
        header={
          <PageHeader
            title="진단 결과"
            description={"진단 요약을 확인하고\n필요한 상세 정보를 펼쳐보세요."}
            mascot="result"
          />
        }
      >
        <Card radius="lg" padding="lg" className="flex flex-col gap-2">
          <p className="text-cropy-label-xs font-medium text-cropy-text-secondary">AI 진단 결과</p>
          <p className="text-cropy-heading-lg text-cropy-text-primary">고추 탄저병</p>
          <div className="flex items-center gap-2">
            <Badge tone="attention">주의</Badge>
            <span className="text-cropy-label-xs font-medium text-cropy-text-secondary">
              신뢰도 90%
            </span>
          </div>
          <p className="text-cropy-caption text-cropy-text-secondary">
            지금 관리하면 확산을 줄일 수 있어요.
          </p>
        </Card>
        <Card className="flex flex-col gap-2">
          <p className="text-cropy-feedback-title text-cropy-text-primary">지금 해야 할 일</p>
          {["감염 부위 제거", "주변 포기 확인", "약제 기준 확인"].map((step, index) => (
            <p key={step} className="text-cropy-feedback-body text-cropy-text-primary">
              {index + 1}. {step}
            </p>
          ))}
        </Card>
        <section aria-labelledby="shell-details" className="flex flex-col gap-2">
          <h2 id="shell-details" className="text-cropy-helper font-bold text-cropy-text-secondary">
            상세 정보
          </h2>
          <Accordion items={DETAILS} />
        </section>
        <Button variant="secondary" size="compact">
          새 사진으로 진단하기
        </Button>
      </AppShellPage>
    </Shell>
  );
}

function OneActionScreen() {
  return (
    <Shell current="history">
      <AppShellPage
        header={<PageHeader title="진단 이력" description="저장한 기록을 확인할 수 있어요." />}
        actions={
          <ActionBar>
            <Button>새 사진으로 진단하기</Button>
          </ActionBar>
        }
        scrollLabel="진단 이력 목록"
      >
        {Array.from({ length: 9 }, (_, index) => (
          <Card key={index} className="flex min-h-[5.5rem] items-center gap-3">
            <div className="h-12 w-12 shrink-0 rounded-xl bg-cropy-surface-canvas" />
            <div className="min-w-0 flex-1">
              <p className="text-cropy-feedback-body font-bold text-cropy-text-primary">
                고추 탄저병 {index + 1}
              </p>
              <p className="text-cropy-caption text-cropy-text-secondary">고추 · 오늘 오후 2:18</p>
            </div>
            <Badge tone="attention" className="shrink-0">
              주의
            </Badge>
          </Card>
        ))}
      </AppShellPage>
    </Shell>
  );
}

/** M-03-1 진단 시작: 버튼 둘(행동 영역 144px) */
export const MobileTwoActions: Story = {
  render: () => <StartScreen />,
};

/** M-03 진단 결과: 행동 영역 없이 본문이 내비 위까지 내려온다. 본문만 스크롤된다 */
export const MobileNoActions: Story = {
  render: () => <ResultScreen />,
};

/** 버튼 하나(84px)와 긴 목록. 제목 영역과 행동 영역은 제자리에 있다 */
export const MobileOneAction: Story = {
  render: () => <OneActionScreen />,
};

/** 데스크탑 1440×960: 헤더 80 / 제목 160 / 행동 영역 80 / 푸터 64 */
export const Desktop: Story = {
  globals: { viewport: { value: "desktop" } },
  render: () => <StartScreen />,
};

/** 데스크탑에서 본문이 길 때 */
export const DesktopScroll: Story = {
  globals: { viewport: { value: "desktop" } },
  render: () => <OneActionScreen />,
};

/** Figma 에 없는 폭(768px): 모바일 틀을 그대로 쓴다 */
export const Tablet: Story = {
  globals: { viewport: { value: "tablet" } },
  render: () => <ResultScreen />,
};

/** 큰글씨 모드: 고정 영역이 커진 만큼 본문이 줄고, 본문은 스크롤된다 */
export const LargeText: Story = {
  globals: { viewport: { value: "mobile" }, textsize: "large" },
  render: () => <StartScreen />,
};
