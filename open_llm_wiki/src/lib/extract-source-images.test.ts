import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}))

import { buildImageMarkdownSection, type SavedImage } from "@/lib/extract-source-images"

function image(overrides: Partial<SavedImage> = {}): SavedImage {
  return {
    index: 1,
    mimeType: "image/png",
    page: 4,
    width: 800,
    height: 800,
    relPath: "media/主图设计/img-1.png",
    absPath: "/project/wiki/media/主图设计/img-1.png",
    sha256: "sha-1",
    ...overrides,
  }
}

describe("buildImageMarkdownSection", () => {
  it("writes searchable fallback alt text instead of empty image refs", () => {
    const markdown = buildImageMarkdownSection([image()])

    expect(markdown).toContain("![第 4 页图片 1，待补充视觉说明](media/主图设计/img-1.png)")
    expect(markdown).not.toContain("![](media/主图设计/img-1.png)")
  })

  it("uses caption text when available", () => {
    const captions = new Map([["sha-1", "细节图案例：材质纹理和卖点文案"]])

    const markdown = buildImageMarkdownSection([image()], captions)

    expect(markdown).toContain("![细节图案例：材质纹理和卖点文案](media/主图设计/img-1.png)")
  })
})
