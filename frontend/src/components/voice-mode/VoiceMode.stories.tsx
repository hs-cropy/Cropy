import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { VoiceMode } from "./VoiceMode";

const meta = {
  title: "Voice/VoiceMode",
  component: VoiceMode,
  parameters: {
    layout: "fullscreen",
    nextjs: {
      appDirectory: true,
    },
  },
  argTypes: {
    state: {
      control: "select",
      options: ["idle", "listening", "thinking", "speaking"],
    },
  },
  args: {
    state: "idle",
  },
} satisfies Meta<typeof VoiceMode>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Interactive: Story = {};

export const Idle: Story = {
  args: { state: "idle" },
};

export const Listening: Story = {
  args: { state: "listening", transcript: "고추 잎에 갈색 점이 생겼어", inputLevel: 0.5 },
};

export const Thinking: Story = {
  args: { state: "thinking", micDisabled: true, transcript: "고추 잎에 갈색 점이 생겼어" },
};

export const Speaking: Story = {
  args: {
    state: "speaking",
    assistantText:
      "갈색 점이 둥글게 번지면 고추 탄저병일 수 있어요. 잎 사진으로 확인하면 더 정확히 알려드릴게요.",
    outputLevel: 0.6,
  },
};