import type { Meta, StoryObj } from '@storybook/react';
import { expect, within } from 'storybook/test';
import { ReceiptCard } from './receipt-card';

const meta = {
  title: 'Design System/ReceiptCard',
  component: ReceiptCard,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="max-w-2xl w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReceiptCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    hash: '0x3f9b2d8e4a1c7f5e9d2b8a4c1e7f3b9d2a8e4c1f5a9d2b8e4c1f7a5d9b2e8c1',
    price: '0.0050',
    agentInstruction: 'Run full verification suite on PR #23',
    timestamp: '2026-07-24T12:34:56Z',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Sample receipt' })).toBeInTheDocument();
    await expect(canvas.getByText('Unsigned demo')).toBeInTheDocument();
    await expect(canvas.queryByRole('link', { name: 'Verify' })).not.toBeInTheDocument();
  },
};

export const Signed: Story = {
  args: {
    hash: '0x3f9b2d8e4a1c7f5e9d2b8a4c1e7f3b9d2a8e4c1f5a9d2b8e4c1f7a5d9b2e8c1',
    receiptId: 'receipt-demo-001',
    price: '0.0050',
    agentInstruction: 'Run full verification suite on PR #23',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Signed receipt' })).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: 'Verify' })).toHaveAttribute('href', '/receipts/receipt-demo-001');
  },
};
