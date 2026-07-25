import type { Meta, StoryObj } from '@storybook/react';
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
    <div className="flex justify-center items-center min-h-screen bg-slate-950 p-8 overflow-auto">
      <div className="shadow-2xl ring-1 ring-white/10 shrink-0">
        <OpenGraphBanner />
      </div>
    </div>
  ),
};

export const XHeader: StoryObj = {
  render: () => (
    <div className="flex justify-center items-center min-h-screen bg-slate-950 p-8 overflow-auto">
      <div className="shadow-2xl ring-1 ring-white/10 shrink-0">
        <XBanner />
      </div>
    </div>
  ),
};
