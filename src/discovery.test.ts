import { describe, expect, it } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import {
  parsePublicOrigin,
  transformHtmlMetadata,
  generateRobotsTxt,
  generateSitemapXml,
  requirePublicMetadataOutputDirectory,
} from "./lib/public-metadata"

const rootDir = path.resolve(__dirname, "..")

describe("agent discovery & public metadata files", () => {
  it("public/skill.md documents the complete contract, 3 capabilities, and accurate receipt verification sequence", () => {
    const skillPath = path.join(rootDir, "public", "skill.md")
    expect(fs.existsSync(skillPath)).toBe(true)

    const content = fs.readFileSync(skillPath, "utf-8")
    // Endpoints
    expect(content).toContain("POST /api/inspect")
    expect(content).toContain("POST /api/verify")
    expect(content).toContain("GET /api/runs/{id}")
    expect(content).toContain("GET /api/receipts/{id}")
    expect(content).toContain("GET /api/receipt-keys/{keyId}")
    expect(content).toContain("POST /api/receipts/verify")
    expect(content).toContain("POST /a2mcp/inspect_repository")
    expect(content).toContain("POST /a2mcp/verify_repository")

    // Launch capabilities
    expect(content).toContain("inspect_repository")
    expect(content).toContain("verify_repository")
    expect(content).toContain("verify_receipt")
    expect(content).toContain("configured free / paid x402")

    // Receipt verification contract & exact sequence
    expect(content).toContain("Get Receipt Public Key")
    expect(content).toContain("Verify Receipt")
    expect(content).toContain("Receipt verification flow")
    expect(content).toContain("PAYLOAD_HASH_MISMATCH")
    expect(content).toContain("UNKNOWN_KEY")
    expect(content).toContain("INVALID_SIGNATURE")
    expect(content).toContain("INVALID_RECEIPT")
    expect(content).toContain("RECEIPT_NOT_FOUND")
    expect(content).toContain("REQUEST_BODY_TOO_LARGE")

    // Verification step-by-step sequence assertions
    expect(content).toContain("Canonicalize `receipt.payload` using JCS (RFC 8785)")
    expect(content).toContain("Compute SHA-256 digest of canonicalized payload and compare to `receipt.payloadHash`")
    expect(content).toContain("Verify `receipt.signature` using Ed25519 over canonicalized payload bytes against fetched `publicKey`")
    expect(content).not.toMatch(/verify Ed25519 signature over .* payload hash/i)

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

  it("public/llms.txt lists real contract surfaces, capabilities, and accurate receipt verification sequence", () => {
    const llmsPath = path.join(rootDir, "public", "llms.txt")
    expect(fs.existsSync(llmsPath)).toBe(true)

    const content = fs.readFileSync(llmsPath, "utf-8")
    expect(content).toContain("Human UI: /")
    expect(content).toContain("Agent contract: /skill.md")
    expect(content).toContain("Synthetic demo PASS receipt: /examples/passed")
    expect(content).toContain("Synthetic demo FAIL receipt: /examples/broken")

    expect(content).toContain("inspect_repository")
    expect(content).toContain("verify_repository")
    expect(content).toContain("verify_receipt")

    expect(content).toContain("POST /api/inspect")
    expect(content).toContain("POST /api/verify")
    expect(content).toContain("GET /api/runs/{id}")
    expect(content).toContain("GET /api/receipts/{id}")
    expect(content).toContain("GET /api/receipt-keys/{keyId}")
    expect(content).toContain("POST /api/receipts/verify")
    expect(content).toContain("POST /a2mcp/inspect_repository")
    expect(content).toContain("POST /a2mcp/verify_repository")

    expect(content).toContain("Signed receipt JSON & Verification Flow")
    expect(content).toContain("contractVersion")
    expect(content).toContain("payloadHash")

    // Verification step-by-step sequence assertions
    expect(content).toContain("Canonicalize `receipt.payload` using JCS (RFC 8785)")
    expect(content).toContain("Compute SHA-256 digest of canonicalized payload and compare to `receipt.payloadHash`")
    expect(content).toContain("Verify `receipt.signature` using Ed25519 over canonicalized payload bytes against fetched `publicKey`")
    expect(content).not.toMatch(/verify Ed25519 signature over .* payload hash/i)

    expect(content).toMatch(/Public HTTP endpoints, signed receipts, OKX\.AI, and paid x402 are not\s+live/)
    expect(content).toContain("Timeout is never FAIL")
    expect(content).not.toContain('"1.0.0"')
  })

  it("synthetic demo examples are nowhere represented as real receipts, source references, or provenance evidence", () => {
    const filesToAudit = [
      path.join(rootDir, "src", "pages", "LandingPage.tsx"),
      path.join(rootDir, "src", "components", "layout", "header.tsx"),
      path.join(rootDir, "src", "components", "layout", "footer.tsx"),
      path.join(rootDir, "public", "llms.txt"),
      path.join(rootDir, "public", "skill.md"),
    ]

    for (const filePath of filesToAudit) {
      expect(fs.existsSync(filePath)).toBe(true)
      const content = fs.readFileSync(filePath, "utf-8")
      expect(content).not.toMatch(/source reference/i)
      expect(content).not.toMatch(/provenance evidence/i)
      expect(content).not.toMatch(/real receipt/i)
    }
  })

  it("public/robots.txt and index.html maintain clean metadata without relative or localhost URLs", () => {
    const robotsPath = path.join(rootDir, "public", "robots.txt")
    expect(fs.existsSync(robotsPath)).toBe(true)
    const robots = fs.readFileSync(robotsPath, "utf-8")
    expect(robots).toContain("User-agent: *")
    expect(robots).toContain("Allow: /")
    expect(robots).not.toContain("Sitemap: /sitemap.xml")
    expect(robots).not.toContain("https://localhost/")

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

  describe("PUBLIC_BASE_URL origin validation and metadata generation", () => {
    it("requires an explicit build output directory for public metadata", () => {
      expect(() => requirePublicMetadataOutputDirectory(undefined)).toThrow(
        /requires an output directory/,
      )
      expect(() => requirePublicMetadataOutputDirectory("")).toThrow(
        /requires an output directory/,
      )
      expect(requirePublicMetadataOutputDirectory("/tmp/public-site")).toBe(
        "/tmp/public-site",
      )
    })

    it("validates and normalizes valid HTTPS public origins", () => {
      expect(parsePublicOrigin("https://proof-runner.example")).toBe("https://proof-runner.example")
      expect(parsePublicOrigin("https://proof-runner.example/")).toBe("https://proof-runner.example")
      expect(parsePublicOrigin("  https://proof-runner.example/  ")).toBe("https://proof-runner.example")
      expect(parsePublicOrigin("https://proof-runner.example:8443")).toBe("https://proof-runner.example:8443")
      expect(parsePublicOrigin(undefined)).toBeNull()
      expect(parsePublicOrigin(null)).toBeNull()
      expect(() => parsePublicOrigin("")).toThrow(/must not be blank/)
      expect(() => parsePublicOrigin("   ")).toThrow(/must not be blank/)
      expect(() => parsePublicOrigin("///")).toThrow(/must be a valid URL string/)
    })

    it("rejects non-public hostnames including localhost, .localhost, 127.0.0.0/8 IPv4 loopback, and ::1 IPv6 loopback", () => {
      expect(() => parsePublicOrigin("https://localhost")).toThrow(/must use a public hostname, not localhost or loopback/)
      expect(() => parsePublicOrigin("https://app.localhost")).toThrow(/must use a public hostname, not localhost or loopback/)
      expect(() => parsePublicOrigin("https://127.0.0.1")).toThrow(/must use a public hostname, not localhost or loopback/)
      expect(() => parsePublicOrigin("https://127.10.20.30")).toThrow(/must use a public hostname, not localhost or loopback/)
      expect(() => parsePublicOrigin("https://[::1]")).toThrow(/must use a public hostname, not localhost or loopback/)
    })

    it("rejects malformed URLs, non-HTTPS protocols, credentials, queries, hashes, and custom paths", () => {
      expect(() => parsePublicOrigin("not-a-url")).toThrow(/must be a valid URL string/)
      expect(() => parsePublicOrigin("http://proof-runner.example")).toThrow(/must use https:\/\/ protocol/)
      expect(() => parsePublicOrigin("https://user:pass@proof-runner.example")).toThrow(/credentials are not allowed/)
      expect(() => parsePublicOrigin("https://proof-runner.example?query=1")).toThrow(/query parameters are not allowed/)
      expect(() => parsePublicOrigin("https://proof-runner.example#hash")).toThrow(/hash fragments are not allowed/)
      expect(() => parsePublicOrigin("https://proof-runner.example/subpath")).toThrow(/path is not allowed/)
    })

    it("transforms HTML metadata, robots.txt, and sitemap.xml deterministically without stale dist dependency", () => {
      const origin = "https://proof-runner.example"
      const rawHtml = "<html><head><title>Test</title></head><body></body></html>"

      const transformedHtml = transformHtmlMetadata(rawHtml, origin)
      expect(transformedHtml).toContain('<link rel="canonical" href="https://proof-runner.example/" />')
      expect(transformedHtml).toContain('<meta property="og:url" content="https://proof-runner.example/" />')

      const robotsTxt = generateRobotsTxt(origin)
      expect(robotsTxt).toContain("Sitemap: https://proof-runner.example/sitemap.xml")

      const sitemapXml = generateSitemapXml(origin)
      expect(sitemapXml).not.toBeNull()
      expect(sitemapXml).toContain("<loc>https://proof-runner.example/</loc>")
      expect(sitemapXml).toContain("<loc>https://proof-runner.example/skill.md</loc>")
      expect(sitemapXml).toContain("<loc>https://proof-runner.example/llms.txt</loc>")
      expect(sitemapXml).toContain("<loc>https://proof-runner.example/examples/passed</loc>")
      expect(sitemapXml).toContain("<loc>https://proof-runner.example/examples/broken</loc>")
    })

    it("writes build metadata output to a temporary directory without relying on pre-existing dist", () => {
      const tempDir = mkdtempSync(path.join(tmpdir(), "metadata-build-test-"))
      try {
        const origin = "https://proof-runner.example"
        const indexHtmlPath = path.join(tempDir, "index.html")
        const robotsPath = path.join(tempDir, "robots.txt")
        const sitemapPath = path.join(tempDir, "sitemap.xml")

        const rawHtml = fs.readFileSync(path.join(rootDir, "index.html"), "utf-8")
        writeFileSync(indexHtmlPath, transformHtmlMetadata(rawHtml, origin), "utf-8")
        writeFileSync(robotsPath, generateRobotsTxt(origin), "utf-8")

        const sitemapContent = generateSitemapXml(origin)
        if (sitemapContent) {
          writeFileSync(sitemapPath, sitemapContent, "utf-8")
        }

        expect(fs.existsSync(indexHtmlPath)).toBe(true)
        const html = fs.readFileSync(indexHtmlPath, "utf-8")
        expect(html).toContain('<link rel="canonical" href="https://proof-runner.example/" />')
        expect(html).toContain('<meta property="og:url" content="https://proof-runner.example/" />')

        expect(fs.existsSync(robotsPath)).toBe(true)
        const robots = fs.readFileSync(robotsPath, "utf-8")
        expect(robots).toContain("Sitemap: https://proof-runner.example/sitemap.xml")

        expect(fs.existsSync(sitemapPath)).toBe(true)
        const sitemap = fs.readFileSync(sitemapPath, "utf-8")
        expect(sitemap).toContain("<loc>https://proof-runner.example/</loc>")
        expect(sitemap).toContain("<loc>https://proof-runner.example/skill.md</loc>")
        expect(sitemap).toContain("<loc>https://proof-runner.example/llms.txt</loc>")
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })
  })
})
