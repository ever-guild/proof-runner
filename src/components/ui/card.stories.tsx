import type { Meta, StoryObj } from '@storybook/react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './card';
import { Button } from './button';
import { Input } from './input';

const meta = {
  title: 'Design System/Card',
  component: Card,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[400px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Card>
      <CardHeader>
        <CardTitle>Inspect Repository</CardTitle>
        <CardDescription>Enter a GitHub repository URL to verify its state and execute tests.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-400 uppercase tracking-wider">Repository URL</label>
          <Input placeholder="https://github.com/..." />
        </div>
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button variant="ghost">Cancel</Button>
        <Button variant="primary">Run Inspection</Button>
      </CardFooter>
    </Card>
  ),
};

export const Receipt: Story = {
  render: () => (
    <Card className="border-pass/30 shadow-[0_0_30px_rgba(16,185,129,0.1)]">
      <CardHeader>
        <CardTitle className="text-pass">Cryptographic Receipt</CardTitle>
        <CardDescription>Execution verified and stored.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <p className="text-xs text-slate-500 uppercase tracking-wider">Transaction Hash</p>
          <p className="font-mono text-sm text-slate-300 break-all">0x7f4a2...b991c</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-slate-500 uppercase tracking-wider">Cost</p>
          <p className="font-mono text-sm text-slate-300">0.0042 ETH</p>
        </div>
      </CardContent>
    </Card>
  ),
};
