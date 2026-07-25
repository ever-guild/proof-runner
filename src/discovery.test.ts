import { describe, expect, it } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"

const rootDir = path.resolve(__dirname, "..")

describe("agent discovery & public metadata files", () => {
  it("public/skill.md documents the deployed contract without inventing availability", () => {
    const skillPath = path.join(rootDir, "public", "skill.md")
    expect(fs.existsSync(skillPath)).toBe(true)

    const content = fs.readFileSync(skillPath, "utf-8")
    // Endpoints
    expect(content).toContain("POST /api/inspect")
    expect(content).toContain("POST /api/verify")
    expect(content).toContain("GET /api/runs/{id}")
    expect(content).toContain("GET /api/receipts/{id}")
    expect(content).toContain("POST /a2mcp/inspect_repository")
    expect(content).toContain("POST /a2mcp/verify_repository")

    // Request contract and statuses
    expect(content).toContain('"contractVersion": "1.0"')
    expect(content).toContain("Idempotency-Key")
    expect(content).toContain("resolvedRef")
    expect(content).toContain("skill")
    expect(content).toContain("public")
    expect(content).toContain("QUEUED")
    expect(content).toContain("RUNNING")
    expect(content).toContain("COMPLETED")
    expect(content).toContain("TIMEOUT")
    expect(content).toContain("SYSTEM_ERROR")

    // Verdict semantics
    expect(content).toContain("PASS")
    expect(content).toContain("FAIL")
    expect(content).toContain("INCONCLUSIVE")
    expect(content).toContain("Timeouts and system failures are strictly `INCONCLUSIVE`, never `FAIL`.")

    // Truthful availability and receipt semantics
    expect(content).toContain("not currently publicly available")
    expect(content).toContain("when a receipt has been issued")
    expect(content).toContain("not live")
    expect(content).toContain("PAYMENT-REQUIRED")
    expect(content).toContain("idempotent replay")
    expect(content).not.toContain('"1.0.0"')
  })

  it("public/llms.txt lists real contract surfaces without a fabricated receipt sample", () => {
    const llmsPath = path.join(rootDir, "public", "llms.txt")
    expect(fs.existsSync(llmsPath)).toBe(true)

    const content = fs.readFileSync(llmsPath, "utf-8")
    expect(content).toContain("Human UI: /")
    expect(content).toContain("Agent contract: /skill.md")
    expect(content).toContain("Demo PASS source reference: /examples/passed")
    expect(content).toContain("Demo FAIL source reference: /examples/broken")

    expect(content).toContain("POST /api/inspect")
    expect(content).toContain("POST /api/verify")
    expect(content).toContain("GET /api/runs/{id}")
    expect(content).toContain("GET /api/receipts/{id}")
    expect(content).toContain("POST /a2mcp/inspect_repository")
    expect(content).toContain("POST /a2mcp/verify_repository")

    expect(content).toContain("Signed receipt JSON")
    expect(content).toContain("contractVersion")
    expect(content).toContain("payloadHash")
    expect(content).toMatch(/Public HTTP endpoints, signed receipts, OKX\.AI, and paid x402 are not\s+live/)
    expect(content).toContain("Timeout is never FAIL")
    expect(content).not.toContain('"1.0.0"')
  })

  it("public/robots.txt provides generic crawl rules without an invalid relative sitemap URL", () => {
    const robotsPath = path.join(rootDir, "public", "robots.txt")
    expect(fs.existsSync(robotsPath)).toBe(true)
    const robots = fs.readFileSync(robotsPath, "utf-8")
    expect(robots).toContain("User-agent: *")
    expect(robots).toContain("Allow: /")
    expect(robots).not.toContain("Sitemap: /sitemap.xml")
  })

  it("index.html keeps generic metadata without publishing a localhost canonical URL", () => {
    const htmlPath = path.join(rootDir, "index.html")
    expect(fs.existsSync(htmlPath)).toBe(true)

    const html = fs.readFileSync(htmlPath, "utf-8")
    expect(html).not.toContain("https://localhost/")
    expect(html).toContain('<meta property="og:title" content="ProofRunner — Run it. Prove it." />')
    expect(html).toContain('<meta property="og:description" content="Independent execution verification for agent-generated software." />')
    expect(html).toContain('<meta property="og:type" content="website" />')
    expect(html).toContain('<link rel="icon" href="/favicon.svg"')
    expect(html).toContain("<title>ProofRunner - Run it. Prove it.</title>")
  })
})
