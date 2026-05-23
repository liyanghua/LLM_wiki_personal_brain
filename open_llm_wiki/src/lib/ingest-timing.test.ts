import { describe, expect, it, beforeEach, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  createDirectory: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  listDirectory: vi.fn(),
}))

import { readFile, listDirectory } from "@/commands/fs"
import {
  formatIngestPhaseLabel,
  loadLatestIngestTimingSummary,
} from "@/lib/ingest-timing"

const mockReadFile = vi.mocked(readFile)
const mockListDirectory = vi.mocked(listDirectory)

beforeEach(() => {
  mockReadFile.mockReset()
  mockListDirectory.mockReset()
})

describe("ingest timing summary", () => {
  it("summarizes the latest batch and separates core from enrichment time", async () => {
    mockListDirectory.mockResolvedValue([
      { name: "old.jsonl", path: "/project/.llm-wiki/ingest-runs/old.jsonl", is_dir: false },
      { name: "new-a.jsonl", path: "/project/.llm-wiki/ingest-runs/new-a.jsonl", is_dir: false },
      { name: "new-post.jsonl", path: "/project/.llm-wiki/ingest-runs/new-post.jsonl", is_dir: false },
      { name: "latest-summary.md", path: "/project/.llm-wiki/ingest-runs/latest-summary.md", is_dir: false },
    ] as never)
    mockReadFile.mockImplementation(async (path: string) => {
      if (path.endsWith("old.jsonl")) {
        return JSON.stringify({
          runId: "old",
          batchId: "batch-old",
          sourceKey: "raw/sources/old.md",
          phase: "structuring",
          startedAt: "2026-05-21T00:00:00.000Z",
          endedAt: "2026-05-21T00:01:00.000Z",
          durationMs: 60_000,
          status: "done",
        }) + "\n"
      }
      if (path.endsWith("new-a.jsonl")) {
        return [
          {
            runId: "new-a",
            batchId: "batch-new",
            sourceKey: "raw/sources/a.xlsx",
            phase: "analysisLlm",
            startedAt: "2026-05-21T01:00:00.000Z",
            endedAt: "2026-05-21T01:02:00.000Z",
            durationMs: 120_000,
            status: "done",
          },
          {
            runId: "new-a",
            batchId: "batch-new",
            sourceKey: "raw/sources/a.xlsx",
            phase: "structuring",
            startedAt: "2026-05-21T01:02:00.000Z",
            endedAt: "2026-05-21T01:07:00.000Z",
            durationMs: 300_000,
            status: "done",
          },
        ].map((item) => JSON.stringify(item)).join("\n") + "\n"
      }
      return [
        {
          runId: "new-post",
          batchId: "batch-new",
          sourceKey: "batch-post-processing",
          phase: "taskIndex",
          startedAt: "2026-05-21T01:07:00.000Z",
          endedAt: "2026-05-21T01:07:01.000Z",
          durationMs: 1_000,
          status: "done",
        },
        {
          runId: "new-post",
          batchId: "batch-new",
          sourceKey: "batch-post-processing",
          phase: "strategyCompile",
          startedAt: "2026-05-21T01:07:01.000Z",
          endedAt: "2026-05-21T01:37:01.000Z",
          durationMs: 1_800_000,
          status: "done",
        },
      ].map((item) => JSON.stringify(item)).join("\n") + "\n"
    })

    const summary = await loadLatestIngestTimingSummary("/project")

    expect(summary).toMatchObject({
      batchId: "batch-new",
      sourceCount: 1,
      totalDurationMs: 2_221_000,
      coreDurationMs: 421_000,
      enrichmentDurationMs: 1_800_000,
    })
    expect(summary?.phases.map((phase) => [phase.phase, phase.durationMs])).toEqual([
      ["analysisLlm", 120_000],
      ["structuring", 300_000],
      ["taskIndex", 1_000],
      ["strategyCompile", 1_800_000],
    ])
  })

  it("returns null when no timing history exists", async () => {
    mockListDirectory.mockRejectedValue(new Error("ENOENT"))

    await expect(loadLatestIngestTimingSummary("/project")).resolves.toBeNull()
  })

  it("formats ingest phase labels for the activity panel", () => {
    expect(formatIngestPhaseLabel("analysisLlm")).toBe("文档理解")
    expect(formatIngestPhaseLabel("strategyCompile")).toBe("策略编译")
    expect(formatIngestPhaseLabel("unknownPhase")).toBe("unknownPhase")
  })
})
