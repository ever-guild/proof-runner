import type { Meta, StoryObj } from '@storybook/react';
import { AppLayout } from './app-layout';
import { Card, CardHeader, CardTitle, CardDescription } from '../ui/card';

const meta = {
  title: 'Design System/Senior UX/AppLayout',
  component: AppLayout,
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof AppLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <AppLayout>
      <Card>
        <CardHeader>
          <CardTitle>Welcome to ProofRunner</CardTitle>
          <CardDescription>This content is properly contained in a responsive grid, with a beautiful header and smooth fade-in animation.</CardDescription>
        </CardHeader>
      </Card>
    </AppLayout>
  ),
};
