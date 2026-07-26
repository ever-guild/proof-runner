function isNonPublicHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (host === "localhost" || host.endsWith(".localhost")) {
    return true
  }
  if (/^127\.\d+\.\d+\.\d+$/.test(host)) {
    return true
  }
  if (host === "::1" || host === "0000:0000:0000:0000:0000:0000:0000:0001") {
    return true
  }
  return false
}

export function parsePublicOrigin(rawOrigin?: string | null): string | null {
  if (!rawOrigin) return null
  const trimmed = rawOrigin.trim()
  if (!trimmed) return null

  const urlCandidate = trimmed.replace(/\/+$/, "")
  if (!urlCandidate) return null

  let parsed: URL
  try {
    parsed = new URL(urlCandidate)
  } catch {
    throw new Error(`Invalid PUBLIC_BASE_URL "${rawOrigin}": must be a valid URL string.`)
  }

  if (parsed.protocol !== "https:") {
    throw new Error(`Invalid PUBLIC_BASE_URL "${rawOrigin}": must use https:// protocol.`)
  }
  if (isNonPublicHost(parsed.hostname)) {
    throw new Error(`Invalid PUBLIC_BASE_URL "${rawOrigin}": must use a public hostname, not localhost or loopback.`)
  }
  if (parsed.username || parsed.password) {
    throw new Error(`Invalid PUBLIC_BASE_URL "${rawOrigin}": credentials are not allowed.`)
  }
  if (parsed.search) {
    throw new Error(`Invalid PUBLIC_BASE_URL "${rawOrigin}": query parameters are not allowed.`)
  }
  if (parsed.hash) {
    throw new Error(`Invalid PUBLIC_BASE_URL "${rawOrigin}": hash fragments are not allowed.`)
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new Error(`Invalid PUBLIC_BASE_URL "${rawOrigin}": path is not allowed.`)
  }

  return parsed.origin
}

export function transformHtmlMetadata(html: string, rawOrigin?: string | null): string {
  const origin = parsePublicOrigin(rawOrigin)
  if (!origin) return html

  const canonicalTag = `<link rel="canonical" href="${origin}/" />`
  const ogUrlTag = `<meta property="og:url" content="${origin}/" />`
  return html.replace("</head>", `  ${canonicalTag}\n    ${ogUrlTag}\n  </head>`)
}

export function generateRobotsTxt(rawOrigin?: string | null): string {
  const origin = parsePublicOrigin(rawOrigin)
  if (origin) {
    return `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`
  }
  return `User-agent: *\nAllow: /\n`
}

export function generateSitemapXml(rawOrigin?: string | null): string | null {
  const origin = parsePublicOrigin(rawOrigin)
  if (!origin) return null

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${origin}/</loc>
  </url>
  <url>
    <loc>${origin}/skill.md</loc>
  </url>
  <url>
    <loc>${origin}/llms.txt</loc>
  </url>
  <url>
    <loc>${origin}/examples/passed</loc>
  </url>
  <url>
    <loc>${origin}/examples/broken</loc>
  </url>
</urlset>
`
}
