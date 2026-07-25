import { describe, expect, it } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"

const rootDir = path.resolve(__dirname, "..")

describe("agent discovery & public metadata files", () => {
  it("public/skill.md exists and contains accurate, truthful contract semantics", () => {
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

    // Headers & Statuses
    expect(content).toContain("Idempotency-Key")
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

    // Truthful availability claim
    expect(content).toContain("unavailable until live deployment is active")
  })

  it("public/llms.txt exists and lists surfaces, endpoints, receipt sample, and limits", () => {
    const llmsPath = path.join(rootDir, "public", "llms.txt")
    expect(fs.existsSync(llmsPath)).toBe(true)

    const content = fs.readFileSync(llmsPath, "utf-8")
    expect(content).toContain("Human UI: /")
    expect(content).toContain("Agent contract: /skill.md")
    expect(content).toContain("Demo PASS receipt: /examples/passed")
    expect(content).toContain("Demo FAIL receipt: /examples/broken")

    expect(content).toContain("POST /api/inspect")
    expect(content).toContain("POST /api/verify")
    expect(content).toContain("GET /api/runs/{id}")
    expect(content).toContain("GET /api/receipts/{id}")
    expect(content).toContain("POST /a2mcp/inspect_repository")
    expect(content).toContain("POST /a2mcp/verify_repository")

    expect(content).toContain("Receipt JSON example")
    expect(content).toContain('"verdict": "PASS"')
    expect(content).toContain("Timeout is never FAIL")
  })

  it("public/robots.txt and public/sitemap.xml exist and have valid structure", () => {
    const robotsPath = path.join(rootDir, "public", "robots.txt")
    expect(fs.existsSync(robotsPath)).toBe(true)
    const robots = fs.readFileSync(robotsPath, "utf-8")
    expect(robots).toContain("User-agent: *")
    expect(robots).toContain("Allow: /")
    expect(robots).toContain("Sitemap: /sitemap.xml")

    const sitemapPath = path.join(rootDir, "public", "sitemap.xml")
    expect(fs.existsSync(sitemapPath)).toBe(true)
    const sitemap = fs.readFileSync(sitemapPath, "utf-8")
    expect(sitemap).toContain("<urlset")
    expect(sitemap).toContain("<loc>/</loc>")
    expect(sitemap).toContain("<loc>/skill.md</loc>")
    expect(sitemap).toContain("<loc>/llms.txt</loc>")
    expect(sitemap).toContain("<loc>/examples/passed</loc>")
    expect(sitemap).toContain("<loc>/examples/broken</loc>")
  })

  it("index.html contains canonical link, Open Graph tags, title, and favicon", () => {
    const htmlPath = path.join(rootDir, "index.html")
    expect(fs.existsSync(htmlPath)).toBe(true)

    const html = fs.readFileSync(htmlPath, "utf-8")
    expect(html).toContain('<link rel="canonical" href="https://localhost/" />')
    expect(html).toContain('<meta property="og:url" content="https://localhost/" />')
    expect(html).toContain('<meta property="og:title" content="ProofRunner — Run it. Prove it." />')
    expect(html).toContain('<meta property="og:description" content="Independent execution verification for agent-generated software." />')
    expect(html).toContain('<meta property="og:type" content="website" />')
    expect(html).toContain('<link rel="icon" href="/favicon.svg"')
    expect(html).toContain("<title>ProofRunner - Run it. Prove it.</title>")
  })
})
