
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { VoiceMode } from "./VoiceMode";

const meta = {
  title: "Voice/VoiceMode",
  component: VoiceMode,
  parameters: {
    layout: "fullscreen",
    viewport: {
      defaultViewport: "mobile",
    },
    nextjs: {
      appDirectory: true,
    },
  },
  args: {
    state: "idle",
  },
} satisfies Meta<typeof VoiceMode>;

export default meta;

type Story = StoryObj<typeof meta>;

export const V01Idle: Story = {
  name: "V-01 대기",
  args: {
    state: "idle",
  },
};

export const V02Listening: Story = {
  name: "V-02 듣는 중",
  args: {
    state: "listening",
  },
};

export const V03Thinking: Story = {
  name: "V-03 생각 중",
  args: {
    state: "thinking",
  },
};

export const V04Speaking: Story = {
  name: "V-04 말하는 중",
  args: {
    state: "speaking",
  },
};
