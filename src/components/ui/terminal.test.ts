import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { Terminal } from "./terminal"

describe("Terminal", () => {
  it("wraps long unbroken log lines instead of overflowing horizontally", () => {
    const longLine = `ERR! ${"a".repeat(400)}`
    const html = renderToStaticMarkup(
      createElement(Terminal, { logs: ["> Running checks...", longLine] }),
    )

    expect(html).toContain(longLine)

    const lineMarkup = html.slice(0, html.indexOf(longLine))
    const openingTag = lineMarkup.slice(lineMarkup.lastIndexOf("<div"))
    expect(openingTag).toContain("break-all")
  })
})
