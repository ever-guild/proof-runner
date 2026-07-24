import type { Meta, StoryObj } from '@storybook/react';
import { Alert, AlertTitle, AlertDescription } from './alert';
import { AlertCircle, Terminal, CheckCircle2 } from 'lucide-react';

const meta = {
  title: 'Design System/Molecules/Alert',
  component: Alert,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="max-w-[500px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Alert>
      <Terminal className="h-4 w-4" />
      <AlertTitle>Heads up!</AlertTitle>
      <AlertDescription>
        You can add components to your app using the cli.
      </AlertDescription>
    </Alert>
  ),
};

export const Destructive: Story = {
  render: () => (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Run inconclusive</AlertTitle>
      <AlertDescription>
        Execution timed out. The verdict is INCONCLUSIVE; review the normalized checks before retrying.
      </AlertDescription>
    </Alert>
  ),
};

export const Success: Story = {
  render: () => (
    <Alert variant="success">
      <CheckCircle2 className="h-4 w-4" />
      <AlertTitle>Verification Complete</AlertTitle>
      <AlertDescription>
        All configured demo checks passed. Production receipt issuance is not represented by this story.
      </AlertDescription>
    </Alert>
  ),
};
