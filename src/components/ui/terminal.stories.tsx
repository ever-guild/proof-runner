import type { Meta, StoryObj } from '@storybook/react';
import { Terminal } from './terminal';

const meta = {
  title: 'Design System/Terminal',
  component: Terminal,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="max-w-3xl w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Terminal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    logs: [
      "$ proofrunner inspect https://github.com/ever-guild/proof-runner",
      "> Cloning repository...",
      "> Analyzing dependencies...",
      "Found 3 compatible skills.",
      "$ proofrunner execute --skill lint",
      "> Running linter...",
      "PASS: No linting errors found.",
      "Generating cryptographic receipt...",
    ],
  },
};

export const WithError: Story = {
  args: {
    logs: [
      "$ proofrunner execute --skill test",
      "> Running test suite...",
      "FAIL: src/components/Badge.test.tsx",
      "  Expected element to have class 'bg-pass/10'",
      "  Received: 'bg-fail/10'",
      "ERR! Execution halted due to test failure.",
    ],
  },
};
