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
})
