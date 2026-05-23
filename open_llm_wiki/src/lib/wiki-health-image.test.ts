import { afterEach, describe, expect, it, vi } from "vitest"
import { createTempProject, readFileRaw, realFs, writeFileRaw } from "@/test-helpers/fs-temp"
import { buildOrRefreshImageIndex } from "@/lib/knowledge-image-index"
import { collectImageHealthMetrics } from "@/lib/wiki-health"

vi.mock("@/commands/fs", () => realFs)

let cleanup: (() => Promise<void>) | null = null

afterEach(async () => {
  if (cleanup) {
    await cleanup()
    cleanup = null
  }
})

describe("collectImageHealthMetrics", () => {
  it("reports image files, markdown refs, empty alt refs, indexed entries, and orphaned files", async () => {
    const tmp = await createTempProject("wiki-health-images")
    cleanup = tmp.cleanup

    await writeFileRaw(`${tmp.path}/wiki/sources/主图设计.md`, [
      "# Source: 主图设计.pdf",
      "",
      "## Embedded Images",
      "",
      "### Page 4",
      "",
      "![](media/主图设计/img-1.png)",
      "![细节图案例](media/主图设计/img-2.png)",
    ].join("\n"))
    await writeFileRaw(`${tmp.path}/wiki/media/主图设计/img-1.png`, "fake image 1")
    await writeFileRaw(`${tmp.path}/wiki/media/主图设计/img-2.png`, "fake image 2")
    await writeFileRaw(`${tmp.path}/wiki/media/主图设计/img-orphan.png`, "fake image orphan")

    await buildOrRefreshImageIndex(tmp.path)
    const metrics = await collectImageHealthMetrics(tmp.path)
    const indexRaw = JSON.parse(await readFileRaw(`${tmp.path}/.llm-wiki/image-index.json`)) as {
      entries: Array<{ relPath: string }>
    }

    expect(indexRaw.entries.map((entry) => entry.relPath)).toEqual([
      "media/主图设计/img-1.png",
      "media/主图设计/img-2.png",
      "media/主图设计/img-orphan.png",
    ])
    expect(metrics).toMatchObject({
      imageFilesTotal: 3,
      imageRefsTotal: 2,
      imageCaptionedTotal: 1,
      imageIndexedTotal: 3,
      imageOrphanedTotal: 1,
      imageEmptyAltTotal: 1,
    })
  })
})
