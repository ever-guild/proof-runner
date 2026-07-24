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
          <label htmlFor="storybook-repository" className="text-sm font-medium text-slate-400 uppercase tracking-wider">Repository URL</label>
          <Input id="storybook-repository" placeholder="https://github.com/..." />
        </div>
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button variant="ghost">Cancel</Button>
        <Button variant="primary">Run Inspection</Button>
      </CardFooter>
    </Card>
  ),
};

export const DemoReceipt: Story = {
  render: () => (
    <Card className="border-pass/30 shadow-[0_0_30px_rgba(16,185,129,0.1)]">
      <CardHeader>
        <CardTitle className="text-pass">Demo Receipt</CardTitle>
        <CardDescription>Sample layout; not a signed production receipt.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <p className="text-xs text-slate-500 uppercase tracking-wider">Report Hash</p>
          <p className="font-mono text-sm text-slate-300 break-all">7f4a2...b991c</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-slate-500 uppercase tracking-wider">Signature</p>
          <p className="font-mono text-sm text-slate-300">Not issued for demo data</p>
        </div>
      </CardContent>
    </Card>
  ),
};
