/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import {
  transformHtmlMetadata,
  generateRobotsTxt,
  generateSitemapXml,
  requirePublicMetadataOutputDirectory,
} from './src/lib/public-metadata';

const dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

function publicMetadataPlugin(): Plugin {
  return {
    name: 'public-metadata',
    transformIndexHtml(html: string) {
      return transformHtmlMetadata(html, process.env.PUBLIC_BASE_URL);
    },
    writeBundle(outputOptions) {
      const outDir = path.resolve(
        dirname,
        requirePublicMetadataOutputDirectory(outputOptions.dir),
      );
      if (!fs.existsSync(outDir)) {
        throw new Error(`Public metadata output directory does not exist: ${outDir}`);
      }

      const robotsPath = path.join(outDir, 'robots.txt');
      fs.writeFileSync(robotsPath, generateRobotsTxt(process.env.PUBLIC_BASE_URL), 'utf-8');

      const sitemapContent = generateSitemapXml(process.env.PUBLIC_BASE_URL);
      if (sitemapContent) {
        const sitemapPath = path.join(outDir, 'sitemap.xml');
        fs.writeFileSync(sitemapPath, sitemapContent, 'utf-8');
      }
    },
  };
}

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig({
  plugins: [react(), publicMetadataPlugin()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/a2mcp': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  test: {
    projects: [{
      extends: true,
      plugins: [
      // The plugin will run tests for the stories defined in your Storybook config
      // See options at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon#storybooktest
      storybookTest({
        configDir: path.join(dirname, '.storybook')
      })],
      test: {
        name: 'storybook',
        browser: {
          enabled: true,
          headless: true,
          // Storybook's shared Vite iframe server can lose dynamic imports when
          // multiple browser story files reload it at once on CI.
          fileParallelism: false,
          provider: playwright({}),
          instances: [
            { browser: 'chromium', name: 'desktop', viewport: { width: 1440, height: 900 } },
            { browser: 'firefox' },
            { browser: 'chromium', name: 'tablet', viewport: { width: 1024, height: 768 } },
            { browser: 'chromium', name: 'mobile', viewport: { width: 390, height: 844 } }
          ]

        }
      }
    }]
  }
});
