import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  createDirectory: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

import { ensureScenePack } from "./scene-pack"
import { createDirectory, readFile, writeFile } from "@/commands/fs"

const mockReadFile = vi.mocked(readFile)
const mockWriteFile = vi.mocked(writeFile)
const mockCreateDirectory = vi.mocked(createDirectory)

beforeEach(() => {
  mockReadFile.mockReset()
  mockWriteFile.mockReset()
  mockCreateDirectory.mockReset()
  mockWriteFile.mockResolvedValue(undefined as unknown as void)
  mockCreateDirectory.mockResolvedValue(undefined as unknown as void)
})

describe("ensureScenePack", () => {
  it("uses task-generation defaults when manifest declares task-generation scene", async () => {
    mockReadFile.mockImplementation(async (path: string) => {
      if (path.endsWith("/.llm-wiki/scene/manifest.json")) {
        return JSON.stringify({
          scene_id: "ecom_growth_task_generation",
          scene_name: "经营任务生成探索",
          doc_type: "ecom_growth_task_generation",
          default_output_language: "Chinese",
          profiles_version: "1.0.0",
          source_snapshot_origin: "project-local",
        })
      }
      return ""
    })

    const pack = await ensureScenePack("/project", { persistDefaults: true, defaultLanguage: "Chinese" })

    expect(pack.manifest.scene_id).toBe("ecom_growth_task_generation")
    expect(pack.schemaProfile.scene_id).toBe("ecom_growth_task_generation")
    expect(pack.expertGuidanceProfile.scene_id).toBe("ecom_growth_task_generation")
    expect(pack.evaluationProfile.scene_id).toBe("ecom_growth_task_generation")
    expect(pack.strategyProfile?.scene_id).toBe("ecom_growth_task_generation")
  })

  it("does not persist defaults when persistDefaults is false", async () => {
    mockReadFile.mockImplementation(async (path: string) => {
      if (path.endsWith("/.llm-wiki/scene/manifest.json")) {
        return JSON.stringify({
          scene_id: "ecom_growth_task_generation",
          scene_name: "经营任务生成探索",
          doc_type: "ecom_growth_task_generation",
          default_output_language: "Chinese",
          profiles_version: "1.0.0",
          source_snapshot_origin: "project-local",
        })
      }
      return ""
    })

    const pack = await ensureScenePack("/project", { persistDefaults: false, defaultLanguage: "Chinese" })

    expect(pack.manifest.scene_id).toBe("ecom_growth_task_generation")
    expect(mockCreateDirectory).not.toHaveBeenCalled()
    expect(mockWriteFile).not.toHaveBeenCalled()
  })
})
