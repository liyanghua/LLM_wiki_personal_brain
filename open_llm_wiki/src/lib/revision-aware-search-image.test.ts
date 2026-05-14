import { afterEach, describe, expect, it, vi } from "vitest"
import { createTempProject, fileExists, realFs, writeFileRaw } from "@/test-helpers/fs-temp"
import { searchKnowledgeWorkspace } from "@/lib/revision-aware-search"

vi.mock("@/commands/fs", () => realFs)

let cleanup: (() => Promise<void>) | null = null

afterEach(async () => {
  if (cleanup) {
    await cleanup()
    cleanup = null
  }
})

describe("searchKnowledgeWorkspace image evidence", () => {
  it("adds indexed image evidence for visual revision-aware questions", async () => {
    const tmp = await createTempProject("revision-aware-image-evidence")
    cleanup = tmp.cleanup
    await writeFileRaw(`${tmp.path}/wiki/index.md`, "# Index\n\n- [[sources/主图设计|主图设计]]\n")
    await writeFileRaw(`${tmp.path}/wiki/sources/主图设计.md`, [
      "# Source: 主图设计.pdf",
      "",
      "主图设计需要关注细节图、卖点图和信任营销图。",
      "",
      "## Embedded Images",
      "",
      "### Page 1",
      "",
      "![](media/主图设计/img-1.png)",
    ].join("\n"))
    await writeFileRaw(`${tmp.path}/wiki/media/主图设计/img-1.png`, "fake image bytes")

    const result = await searchKnowledgeWorkspace({
      projectPath: tmp.path,
      query: "如何提升主图设计的细节？",
      draft: null,
      groundTruth: null,
    })

    expect(await fileExists(`${tmp.path}/.llm-wiki/image-index.json`)).toBe(true)
    expect(result.promptSections.join("\n\n")).toContain("## Image Evidence")
    expect(result.promptSections.join("\n\n")).toContain("Markdown: ![主图设计 第 1 页图片 1")
    expect(result.references.some((ref) => ref.path === "wiki/sources/主图设计.md")).toBe(true)
  })
})
