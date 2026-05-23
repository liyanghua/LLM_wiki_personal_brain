import { afterEach, describe, expect, it, vi } from "vitest"
import { createTempProject, fileExists, readFileRaw, realFs, writeFileRaw } from "@/test-helpers/fs-temp"
import {
  buildOrRefreshImageIndex,
  captionImageIndexEntries,
  captionProjectImagesOnce,
  formatImageEvidenceForPrompt,
  loadImageCaptionBackfillState,
  refreshImageEvidenceFromIndex,
  searchKnowledgeImages,
} from "@/lib/knowledge-image-index"
import type { ChatImageEvidence } from "@/stores/chat-store"
import type { LlmConfig } from "@/stores/wiki-store"

const { mockCaption } = vi.hoisted(() => ({
  mockCaption: vi.fn(),
}))

vi.mock("@/lib/vision-caption", async () => {
  const actual = await vi.importActual<typeof import("@/lib/vision-caption")>("@/lib/vision-caption")
  return {
    ...actual,
    captionImage: mockCaption,
  }
})

vi.mock("@/commands/fs", () => realFs)

let cleanup: (() => Promise<void>) | null = null

const cfg: LlmConfig = {
  provider: "custom",
  apiKey: "",
  model: "vl-test",
  ollamaUrl: "",
  customEndpoint: "http://example/v1",
  apiMode: "chat_completions",
  maxContextSize: 8192,
}

afterEach(async () => {
  mockCaption.mockReset()
  if (cleanup) {
    await cleanup()
    cleanup = null
  }
})

describe("knowledge image index", () => {
  it("builds a recoverable index from existing empty-alt source image refs", async () => {
    const tmp = await createTempProject("image-index-empty-alt")
    cleanup = tmp.cleanup
    await writeFileRaw(`${tmp.path}/wiki/sources/主图设计.md`, [
      "# Source: 主图设计.pdf",
      "",
      "## 关键判断",
      "细节图要体现产品质感、工艺或功能升级。",
      "",
      "<!-- llm-wiki:embedded-images -->",
      "## Embedded Images",
      "",
      "### Page 4",
      "",
      "![](media/主图设计/img-1.png)",
      "<!-- llm-wiki:embedded-images -->",
    ].join("\n"))
    await writeFileRaw(`${tmp.path}/wiki/media/主图设计/img-1.png`, "fake image bytes")

    const entries = await buildOrRefreshImageIndex(tmp.path)
    const indexPath = `${tmp.path}/.llm-wiki/image-index.json`

    expect(await fileExists(indexPath)).toBe(true)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      sourceSlug: "主图设计",
      relPath: "media/主图设计/img-1.png",
      page: 4,
      status: "needs_caption",
    })
    expect(entries[0]?.fallbackCaption).toContain("主图设计 第 4 页图片")
    expect(entries[0]?.nearbyText).toContain("细节图要体现产品质感")
    expect(entries[0]?.sha256).toMatch(/^[a-f0-9]{64}$/)
    const raw = JSON.parse(await readFileRaw(indexPath)) as { entries: unknown[] }
    expect(raw.entries).toHaveLength(1)
  })

  it("normalizes URL-encoded local image refs before persisting image index entries", async () => {
    const tmp = await createTempProject("image-index-encoded-path")
    cleanup = tmp.cleanup
    await writeFileRaw(`${tmp.path}/wiki/sources/高点击率主图制作.md`, [
      "# Source: 高点击率主图制作.pdf",
      "",
      "## 案例图",
      "这里引用了一张 URL 编码路径的主图案例。",
      "",
      "### Page 6",
      "",
      "![](media/%E9%AB%98%E7%82%B9%E5%87%BB%E7%8E%87%E4%B8%BB%E5%9B%BE%E5%88%B6%E4%BD%9C/img-12.png)",
    ].join("\n"))
    await writeFileRaw(`${tmp.path}/wiki/media/高点击率主图制作/img-12.png`, "fake image bytes")

    const entries = await buildOrRefreshImageIndex(tmp.path)

    expect(entries[0]).toMatchObject({
      relPath: "media/高点击率主图制作/img-12.png",
      status: "needs_caption",
    })
    expect(entries[0]?.sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it("searches image index for visual questions and formats prompt evidence", async () => {
    const tmp = await createTempProject("image-index-search")
    cleanup = tmp.cleanup
    await writeFileRaw(`${tmp.path}/wiki/sources/主图设计.md`, [
      "# Source: 主图设计.pdf",
      "",
      "## 细节图案例",
      "细节图要体现产品质感、工艺或功能升级。",
      "",
      "### Page 4",
      "",
      "![材质纹理细节图，展示产品质感](media/主图设计/img-1.png)",
    ].join("\n"))
    await writeFileRaw(`${tmp.path}/wiki/media/主图设计/img-1.png`, "fake image bytes")

    await buildOrRefreshImageIndex(tmp.path)
    const hits = await searchKnowledgeImages(tmp.path, "如何提升主图设计的细节？")
    const prompt = formatImageEvidenceForPrompt(hits)

    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]?.relPath).toBe("media/主图设计/img-1.png")
    expect(prompt).toContain("Markdown: ![材质纹理细节图，展示产品质感](media/主图设计/img-1.png)")
    expect(prompt).toContain("Why relevant:")
  })

  it("returns fallback image candidates for visual questions even when old image refs have empty alt text", async () => {
    const tmp = await createTempProject("image-index-visual-fallback")
    cleanup = tmp.cleanup
    await writeFileRaw(`${tmp.path}/wiki/sources/主图设计.md`, [
      "# Source: 主图设计.pdf",
      "",
      "本文档讲解主图点击率、卖点图、细节图和信任营销图。",
      "",
      "## Embedded Images",
      "",
      "### Page 1",
      "",
      "![](media/主图设计/img-1.png)",
      "![](media/主图设计/img-2.png)",
    ].join("\n"))
    await writeFileRaw(`${tmp.path}/wiki/media/主图设计/img-1.png`, "fake image bytes 1")
    await writeFileRaw(`${tmp.path}/wiki/media/主图设计/img-2.png`, "fake image bytes 2")

    await buildOrRefreshImageIndex(tmp.path)
    const hits = await searchKnowledgeImages(tmp.path, "如何提升主图设计的细节？", { limit: 2 })

    expect(hits).toHaveLength(2)
    expect(hits[0]?.matchedReason).toContain("按来源主题召回，待补图片说明")
    expect(hits[0]?.caption).toContain("缺少视觉说明")
  })

  it("backfills captions for selected image index entries and persists caption cache", async () => {
    const tmp = await createTempProject("image-index-caption-backfill")
    cleanup = tmp.cleanup
    await writeFileRaw(`${tmp.path}/wiki/sources/主图设计.md`, [
      "# Source: 主图设计.pdf",
      "",
      "## 细节图案例",
      "这张图用于说明主图细节、材质质感和卖点放大。",
      "",
      "### Page 2",
      "",
      "![](media/主图设计/img-1.png)",
    ].join("\n"))
    await writeFileRaw(`${tmp.path}/wiki/media/主图设计/img-1.png`, "fake image bytes")
    mockCaption.mockResolvedValue("细节图展示产品材质纹理，并用局部放大强调核心卖点。")

    const entries = await buildOrRefreshImageIndex(tmp.path)
    const result = await captionImageIndexEntries(tmp.path, [entries[0]!.imageId], cfg)

    expect(result.updated).toBe(1)
    expect(result.cached).toBe(0)
    expect(result.failed).toBe(0)
    expect(mockCaption).toHaveBeenCalledTimes(1)

    const indexRaw = JSON.parse(await readFileRaw(`${tmp.path}/.llm-wiki/image-index.json`)) as {
      entries: Array<{ imageId: string; caption: string; status: string }>
    }
    expect(indexRaw.entries[0]).toMatchObject({
      imageId: entries[0]!.imageId,
      caption: "细节图展示产品材质纹理，并用局部放大强调核心卖点。",
      status: "captioned",
    })

    const cacheRaw = JSON.parse(await readFileRaw(`${tmp.path}/.llm-wiki/image-caption-cache.json`)) as Record<string, unknown>
    expect(Object.keys(cacheRaw)).toHaveLength(1)
  })

  it("preserves captioned metadata when refreshing the image index", async () => {
    const tmp = await createTempProject("image-index-preserve-caption")
    cleanup = tmp.cleanup
    await writeFileRaw(`${tmp.path}/wiki/sources/主图设计.md`, [
      "# Source: 主图设计.pdf",
      "",
      "## 细节图案例",
      "这张图用于说明主图细节、材质质感和卖点放大。",
      "",
      "### Page 2",
      "",
      "![](media/主图设计/img-1.png)",
    ].join("\n"))
    await writeFileRaw(`${tmp.path}/wiki/media/主图设计/img-1.png`, "fake image bytes")
    mockCaption.mockResolvedValue("细节图展示产品材质纹理，并用局部放大强调核心卖点。")

    const entries = await buildOrRefreshImageIndex(tmp.path)
    await captionImageIndexEntries(tmp.path, [entries[0]!.imageId], cfg)
    const refreshed = await buildOrRefreshImageIndex(tmp.path)

    expect(refreshed[0]).toMatchObject({
      relPath: "media/主图设计/img-1.png",
      caption: "细节图展示产品材质纹理，并用局部放大强调核心卖点。",
      status: "captioned",
    })
    expect(refreshed[0]?.tags).toContain("细节")
  })

  it("refreshes persisted chat image evidence from the latest image index by relPath", async () => {
    const tmp = await createTempProject("image-index-refresh-message-evidence")
    cleanup = tmp.cleanup
    await writeFileRaw(`${tmp.path}/.llm-wiki/image-index.json`, `${JSON.stringify({
      schemaVersion: 1,
      generatedAt: "2026-01-01T00:00:00.000Z",
      entries: [
        {
          imageId: "image-0099",
          sourceSlug: "主图设计",
          relPath: "media/主图设计/img-1.png",
          sourcePath: "wiki/sources/主图设计.md",
          page: 3,
          sha256: "abc",
          caption: "细节图展示材质质感、卖点放大和局部对比。",
          fallbackCaption: "主图设计 第 3 页图片 1，缺少视觉说明",
          nearbyText: "细节图案例",
          headingPath: ["细节图案例"],
          tags: ["主图", "细节"],
          linkedWikiRefs: ["wiki/business/主图设计/素材与版式.md"],
          status: "captioned",
          indexedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    }, null, 2)}\n`)
    const staleEvidence: ChatImageEvidence[] = [
      {
        imageId: "image-0001",
        displayId: "img-1",
        relPath: "media/主图设计/img-1.png",
        caption: "主图设计 第 3 页图片 1，缺少视觉说明",
        fallbackCaption: "主图设计 第 3 页图片 1，缺少视觉说明",
        sourcePath: "wiki/sources/主图设计.md",
        page: 3,
        matchedReason: "按来源主题召回，待补图片说明",
        status: "needs_caption",
        score: 12,
      },
    ]

    const refreshed = await refreshImageEvidenceFromIndex(tmp.path, staleEvidence)

    expect(refreshed[0]).toMatchObject({
      imageId: "image-0099",
      caption: "细节图展示材质质感、卖点放大和局部对比。",
      status: "captioned",
      matchedReason: "图片说明已补齐，可用于后续检索排序",
    })
  })

  it("reuses cached captions by image hash when backfilling duplicate image entries", async () => {
    const tmp = await createTempProject("image-index-caption-cache")
    cleanup = tmp.cleanup
    await writeFileRaw(`${tmp.path}/wiki/sources/主图设计.md`, [
      "# Source: 主图设计.pdf",
      "",
      "## 细节图案例",
      "细节图要体现产品质感。",
      "",
      "### Page 1",
      "",
      "![](media/主图设计/img-1.png)",
      "![](media/主图设计/img-2.png)",
    ].join("\n"))
    await writeFileRaw(`${tmp.path}/wiki/media/主图设计/img-1.png`, "same image bytes")
    await writeFileRaw(`${tmp.path}/wiki/media/主图设计/img-2.png`, "same image bytes")
    mockCaption.mockResolvedValue("同一张细节图展示材质纹理和卖点局部放大。")

    const entries = await buildOrRefreshImageIndex(tmp.path)
    const result = await captionImageIndexEntries(tmp.path, entries.map((entry) => entry.imageId), cfg)

    expect(result.updated).toBe(1)
    expect(result.cached).toBe(1)
    expect(mockCaption).toHaveBeenCalledTimes(1)
  })

  it("pauses batch captioning after repeated non-retryable VLM failures", async () => {
    const tmp = await createTempProject("image-index-caption-stop")
    cleanup = tmp.cleanup
    await writeFileRaw(`${tmp.path}/wiki/sources/主图设计.md`, [
      "# Source: 主图设计.pdf",
      "",
      "### Page 1",
      "",
      "![](media/主图设计/img-1.png)",
      "![](media/主图设计/img-2.png)",
      "![](media/主图设计/img-3.png)",
      "![](media/主图设计/img-4.png)",
      "![](media/主图设计/img-5.png)",
    ].join("\n"))
    for (let i = 1; i <= 5; i += 1) {
      await writeFileRaw(`${tmp.path}/wiki/media/主图设计/img-${i}.png`, `fake image bytes ${i}`)
    }
    mockCaption.mockRejectedValue(new Error("HTTP 401 — Incorrect API key provided"))

    await buildOrRefreshImageIndex(tmp.path)
    const result = await captionImageIndexEntries(tmp.path, null, {
      ...cfg,
      customEndpoint: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    })

    expect(result.failed).toBe(3)
    expect(result.skipped).toBe(2)
    expect(result.errors[result.errors.length - 1]).toMatchObject({
      imageId: "__batch__",
      failureCode: "invalid_api_key",
      title: "批量补齐已自动暂停",
    })
    expect(mockCaption).toHaveBeenCalledTimes(3)
  })

  it("records project-level caption backfill as a one-time task and skips repeated default runs", async () => {
    const tmp = await createTempProject("image-index-caption-once")
    cleanup = tmp.cleanup
    await writeFileRaw(`${tmp.path}/wiki/sources/主图设计.md`, [
      "# Source: 主图设计.pdf",
      "",
      "### Page 1",
      "",
      "![](media/主图设计/img-1.png)",
      "![](media/主图设计/img-2.png)",
    ].join("\n"))
    await writeFileRaw(`${tmp.path}/wiki/media/主图设计/img-1.png`, "fake image bytes 1")
    await writeFileRaw(`${tmp.path}/wiki/media/主图设计/img-2.png`, "fake image bytes 2")
    mockCaption.mockResolvedValue("主图细节图展示材质质感和卖点放大。")

    await buildOrRefreshImageIndex(tmp.path)
    const first = await captionProjectImagesOnce(tmp.path, cfg)
    const second = await captionProjectImagesOnce(tmp.path, cfg)
    const state = await loadImageCaptionBackfillState(tmp.path)

    expect(first.alreadyHandled).toBe(false)
    expect(first.result.updated).toBe(2)
    expect(second.alreadyHandled).toBe(true)
    expect(second.result.total).toBe(0)
    expect(second.result.skipped).toBe(0)
    expect(mockCaption).toHaveBeenCalledTimes(2)
    expect(state.status).toBe("completed")
    expect(state.remaining).toBe(0)
  })

  it("does not repeatedly retry a paused project caption backfill without force", async () => {
    const tmp = await createTempProject("image-index-caption-once-paused")
    cleanup = tmp.cleanup
    await writeFileRaw(`${tmp.path}/wiki/sources/主图设计.md`, [
      "# Source: 主图设计.pdf",
      "",
      "### Page 1",
      "",
      "![](media/主图设计/img-1.png)",
      "![](media/主图设计/img-2.png)",
      "![](media/主图设计/img-3.png)",
      "![](media/主图设计/img-4.png)",
    ].join("\n"))
    for (let i = 1; i <= 4; i += 1) {
      await writeFileRaw(`${tmp.path}/wiki/media/主图设计/img-${i}.png`, `fake image bytes ${i}`)
    }
    mockCaption.mockRejectedValue(new Error("HTTP 401 — Incorrect API key provided"))

    await buildOrRefreshImageIndex(tmp.path)
    const first = await captionProjectImagesOnce(tmp.path, {
      ...cfg,
      customEndpoint: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    })
    const second = await captionProjectImagesOnce(tmp.path, {
      ...cfg,
      customEndpoint: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    })
    const state = await loadImageCaptionBackfillState(tmp.path)

    expect(first.result.failed).toBe(3)
    expect(first.result.skipped).toBe(1)
    expect(second.alreadyHandled).toBe(true)
    expect(mockCaption).toHaveBeenCalledTimes(3)
    expect(state.status).toBe("paused")
    expect(state.errorTitle).toBe("批量补齐已自动暂停")
  })

  it("ranks caption hits above uncaptions for visual detail queries", async () => {
    const tmp = await createTempProject("image-index-caption-ranking")
    cleanup = tmp.cleanup
    await writeFileRaw(`${tmp.path}/.llm-wiki/image-index.json`, `${JSON.stringify({
      schemaVersion: 1,
      generatedAt: "2026-01-01T00:00:00.000Z",
      entries: [
        {
          imageId: "image-0001",
          sourceSlug: "主图设计",
          relPath: "media/主图设计/img-1.png",
          sourcePath: "wiki/sources/主图设计.md",
          page: 1,
          sha256: "a",
          caption: "主图设计 第 1 页图片 1（Embedded Images），缺少视觉说明",
          fallbackCaption: "主图设计 第 1 页图片 1（Embedded Images），缺少视觉说明",
          nearbyText: "细节图和主图案例",
          headingPath: ["Embedded Images"],
          tags: ["主图", "细节"],
          linkedWikiRefs: [],
          status: "needs_caption",
          indexedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          imageId: "image-0002",
          sourceSlug: "主图设计",
          relPath: "media/主图设计/img-2.png",
          sourcePath: "wiki/sources/主图设计.md",
          page: 2,
          sha256: "b",
          caption: "细节图展示材质质感、局部卖点放大和前后对比。",
          fallbackCaption: "主图设计 第 2 页图片 2，缺少视觉说明",
          nearbyText: "",
          headingPath: ["案例"],
          tags: ["主图"],
          linkedWikiRefs: [],
          status: "captioned",
          indexedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    }, null, 2)}\n`)

    const hits = await searchKnowledgeImages(tmp.path, "细节图 材质质感 卖点放大", { limit: 2 })

    expect(hits[0]?.imageId).toBe("image-0002")
    expect(hits[0]?.matchedReason).toContain("图片说明命中")
  })
})
