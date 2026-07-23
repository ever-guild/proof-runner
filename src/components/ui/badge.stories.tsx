import type { Meta, StoryObj } from '@storybook/react';
import { Badge } from './badge';

const meta = {
  title: 'Design System/Badge',
  component: Badge,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['pass', 'fail', 'running', 'queued'],
    },
    showIcon: {
      control: 'boolean',
    },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pass: Story = {
  args: {
    variant: 'pass',
  },
};

export const Fail: Story = {
  args: {
    variant: 'fail',
  },
};

export const Running: Story = {
  args: {
    variant: 'running',
  },
};

export const Queued: Story = {
  args: {
    variant: 'queued',
  },
};

export const WithoutIcon: Story = {
  args: {
    variant: 'pass',
    showIcon: false,
  },
};
