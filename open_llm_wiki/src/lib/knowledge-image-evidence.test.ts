import { describe, expect, it } from "vitest"
import {
  buildKnowledgeImageEvidenceContext,
  collectKnowledgeImageEvidence,
  hasVisualQuestionIntent,
} from "@/lib/knowledge-image-evidence"
import type { SearchResult } from "@/lib/search"

describe("knowledge image evidence", () => {
  it("collects image evidence for visual questions and formats markdown image lines", () => {
    const results: SearchResult[] = [
      {
        path: "/project/wiki/sources/hero-sop.md",
        title: "主图设计 SOP",
        snippet: "主图细节案例",
        titleMatch: true,
        score: 42,
        images: [
          { url: "media/hero-sop/img-1.png", alt: "主图细节图：材质纹理和卖点文案" },
        ],
      },
    ]
    const evidence = collectKnowledgeImageEvidence(
      "如何提升主图设计的细节？",
      results,
      [
        {
          title: "主图设计 SOP",
          path: "wiki/sources/hero-sop.md",
          content: "![主图细节图：材质纹理和卖点文案](media/hero-sop/img-1.png)",
        },
      ],
      "/project",
    )

    expect(hasVisualQuestionIntent("如何提升主图设计的细节？")).toBe(true)
    expect(evidence).toHaveLength(1)
    expect(evidence[0]?.sourcePageIndex).toBe(1)
    expect(evidence[0]?.url).toBe("media/hero-sop/img-1.png")
    expect(buildKnowledgeImageEvidenceContext(evidence)).toContain(
      "Markdown: ![主图细节图：材质纹理和卖点文案](media/hero-sop/img-1.png)",
    )
  })

  it("does not collect images for non-visual questions", () => {
    const evidence = collectKnowledgeImageEvidence(
      "这个 SOP 的执行步骤是什么？",
      [
        {
          path: "/project/wiki/sources/hero-sop.md",
          title: "主图设计 SOP",
          snippet: "执行步骤",
          titleMatch: false,
          score: 10,
          images: [{ url: "media/hero-sop/img-1.png", alt: "主图案例" }],
        },
      ],
      [],
      "/project",
    )

    expect(evidence).toHaveLength(0)
  })
})
