import type { StoryObj } from '@storybook/react';
import { OpenGraphBanner, XBanner } from './LaunchAssets';

const meta = {
  title: 'Assets/Social Banners',
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
};

export default meta;

export const OpenGraph: StoryObj = {
  render: () => (
    <div className="flex justify-center items-center min-h-screen bg-slate-950 p-8 overflow-auto" role="region" tabIndex={0} aria-label="Scrollable Open Graph banner preview">
      <div className="shadow-2xl ring-1 ring-white/10 shrink-0">
        <OpenGraphBanner />
      </div>
    </div>
  ),
};

export const XHeader: StoryObj = {
  render: () => (
    <div className="flex justify-center items-center min-h-screen bg-slate-950 p-8 overflow-auto" role="region" tabIndex={0} aria-label="Scrollable X banner preview">
      <div className="shadow-2xl ring-1 ring-white/10 shrink-0">
        <XBanner />
      </div>
    </div>
  ),
};
