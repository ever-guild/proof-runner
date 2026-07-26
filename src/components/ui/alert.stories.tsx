import type { Meta, StoryObj } from '@storybook/react';
import { Alert, AlertTitle, AlertDescription } from './alert';
import { AlertCircle, Terminal, CheckCircle2, HelpCircle, Timer, AlertOctagon } from 'lucide-react';

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

export const Inconclusive: Story = {
  render: () => (
    <Alert variant="inconclusive">
      <HelpCircle className="h-4 w-4" />
      <AlertTitle>Run Inconclusive</AlertTitle>
      <AlertDescription>
        The run result could not be determined. Check logs for details.
      </AlertDescription>
    </Alert>
  ),
};

export const Timeout: Story = {
  render: () => (
    <Alert variant="timeout">
      <Timer className="h-4 w-4" />
      <AlertTitle>Execution Timeout</AlertTitle>
      <AlertDescription>
        The execution exceeded the maximum allowed time of 180 seconds.
      </AlertDescription>
    </Alert>
  ),
};

export const SystemError: Story = {
  render: () => (
    <Alert variant="system_error">
      <AlertOctagon className="h-4 w-4" />
      <AlertTitle>System Error</AlertTitle>
      <AlertDescription>
        An internal runner error occurred. Our engineers have been notified.
      </AlertDescription>
    </Alert>
  ),
};
