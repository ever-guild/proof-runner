import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import config from "../vite.config"

describe("Vite development proxy", () => {
  it("forwards API and A2MCP requests to the local API service", () => {
    expect(config.server?.proxy).toMatchObject({
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
      "/a2mcp": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    })
  })

  it("serializes Storybook browser files so their shared Vite iframe stays stable on CI", () => {
    const storybookProject = config.test?.projects?.[0] as {
      test?: { browser?: { fileParallelism?: boolean } }
    }

    expect(storybookProject.test?.browser?.fileParallelism).toBe(false)
  })

  it("runs each Storybook browser project in its own process", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts: Record<string, string> }

    expect(packageJson.scripts["test:storybook"]).toBe(
      "pnpm run test:storybook:desktop && pnpm run test:storybook:tablet && pnpm run test:storybook:mobile",
    )
    expect(packageJson.scripts["test:storybook:desktop"]).toContain("--project desktop")
    expect(packageJson.scripts["test:storybook:tablet"]).toContain("--project tablet")
    expect(packageJson.scripts["test:storybook:mobile"]).toContain("--project mobile")
  })

  it("exercises the PR-010 desktop, tablet, and mobile layout viewports", () => {
    const storybookProject = config.test?.projects?.[0] as {
      test?: { browser?: { instances?: Array<{ name?: string; viewport?: { width: number; height: number } }> } }
    }

    expect(storybookProject.test?.browser?.instances).toEqual(expect.arrayContaining([
      { browser: "firefox", name: "desktop", viewport: { width: 1440, height: 900 } },
      { browser: "chromium", name: "tablet", viewport: { width: 1024, height: 768 } },
      { browser: "chromium", name: "mobile", viewport: { width: 390, height: 844 } },
    ]))
  })
})
