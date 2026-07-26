import type { Meta, StoryObj } from '@storybook/react';
import { SceneErrorEdgeCases } from './SceneErrorEdgeCases';

const meta = {
  title: 'Scenes/ErrorEdgeCases',
  component: SceneErrorEdgeCases,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
  argTypes: {
    errorType: {
      control: 'select',
      options: [
        'inconclusive',
        'timeout',
        'system_error',
        'invalid_ref',
        'oversized_repo',
        'payment_failure',
        'expired_logs',
        'unsupported',
      ],
    },
  },
} satisfies Meta<typeof SceneErrorEdgeCases>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Inconclusive: Story = {
  args: {
    errorType: 'inconclusive',
  },
};

export const Timeout: Story = {
  args: {
    errorType: 'timeout',
  },
};

export const SystemError: Story = {
  args: {
    errorType: 'system_error',
  },
};

export const InvalidRef: Story = {
  args: {
    errorType: 'invalid_ref',
  },
};

export const OversizedRepo: Story = {
  args: {
    errorType: 'oversized_repo',
  },
};

export const PaymentFailure: Story = {
  args: {
    errorType: 'payment_failure',
  },
};

export const ExpiredLogs: Story = {
  args: {
    errorType: 'expired_logs',
  },
};

export const Unsupported: Story = {
  args: {
    errorType: 'unsupported',
  },
};
