import { afterEach, describe, expect, it, vi } from "vitest"
import { getRun, verifyEvidenceBundleArchive } from "./api"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("API response handling", () => {
  it("does not expose the local API address when an upstream response is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>Bad gateway</html>", {
      status: 502,
      headers: { "content-type": "text/html" },
    })))

    await expect(getRun("run-123")).rejects.toMatchObject({
      message: "Invalid response from server (HTTP 502).",
    })
  })

  it("preserves API error messages from JSON responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: "Run not found" },
    }), {
      status: 404,
      headers: { "content-type": "application/json" },
    })))

    await expect(getRun("missing-run")).rejects.toMatchObject({
      message: "Run not found",
    })
  })

  it("returns successful JSON responses", async () => {
    const run = { id: "run-123", status: "QUEUED" }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(run), {
      status: 200,
      headers: { "content-type": "application/json" },
    })))

    await expect(getRun("run-123")).resolves.toEqual(run)
  })

  it("uploads an evidence archive without JSON encoding", async () => {
    const verification = {
      contractVersion: "1.0",
      valid: true,
      reason: null,
      bundleId: "a".repeat(64),
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(verification), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const archive = new Blob(["zip-bytes"], { type: "application/zip" })

    await expect(verifyEvidenceBundleArchive(archive)).resolves.toEqual(
      verification,
    )
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/evidence-bundles/verify",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/zip" },
        body: archive,
      }),
    )
  })
})
