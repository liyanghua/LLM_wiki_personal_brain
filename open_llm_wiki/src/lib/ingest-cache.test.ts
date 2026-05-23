import { describe, it, expect, beforeEach, vi } from "vitest"

// Mock fs so the tests don't touch real disk.
vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  fileExists: vi.fn(),
}))

import { checkIngestCache, checkIngestCacheDetailed, saveIngestCache, type FileFingerprint } from "./ingest-cache"
import { readFile, writeFile, fileExists } from "@/commands/fs"

const mockReadFile = vi.mocked(readFile)
const mockWriteFile = vi.mocked(writeFile)
const mockFileExists = vi.mocked(fileExists)

beforeEach(() => {
  mockReadFile.mockReset()
  mockWriteFile.mockReset()
  mockFileExists.mockReset()
  mockWriteFile.mockResolvedValue(undefined as unknown as void)
})

describe("ingest-cache — checkIngestCache", () => {
  it("returns null when no entry exists", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ entries: {} }))
    const result = await checkIngestCache("/project", "foo.pdf", "content")
    expect(result).toBeNull()
  })

  it("treats a legacy empty cache object as an empty cache", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({}))
    const result = await checkIngestCache("/project", "foo.pdf", "content")
    expect(result).toBeNull()
  })

  it("ignores malformed cache entries instead of crashing", async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        entries: {
          "foo.pdf": {
            hash: 123,
            timestamp: "bad",
            filesWritten: ["wiki/sources/foo.md"],
          },
        },
      }),
    )
    const result = await checkIngestCache("/project", "foo.pdf", "content")
    expect(result).toBeNull()
  })

  it("returns cached filesWritten when hash matches AND all files exist", async () => {
    // Pre-seed cache with a hash matching "hello".
    // We compute the expected hash by running saveIngestCache first in
    // a controlled round-trip, then feeding the same JSON back in.
    let persisted = ""
    mockReadFile.mockImplementation(async () => persisted || JSON.stringify({ entries: {} }))
    mockWriteFile.mockImplementation(async (_p: string, c: string) => {
      persisted = c
    })
    await saveIngestCache("/project", "foo.pdf", "hello", [
      "wiki/sources/foo.md",
      "wiki/entities/bar.md",
    ])

    mockFileExists.mockResolvedValue(true)
    const result = await checkIngestCache("/project", "foo.pdf", "hello")
    expect(result).toEqual(["wiki/sources/foo.md", "wiki/entities/bar.md"])
  })

  it("returns null when hash matches but a cached file no longer exists on disk", async () => {
    // Prime cache, then simulate user deleting one of the written files.
    let persisted = ""
    mockReadFile.mockImplementation(async () => persisted || JSON.stringify({ entries: {} }))
    mockWriteFile.mockImplementation(async (_p: string, c: string) => {
      persisted = c
    })
    await saveIngestCache("/project", "foo.pdf", "hello", [
      "wiki/sources/foo.md",
      "wiki/entities/bar.md",
    ])

    // wiki/entities/bar.md has been deleted since the cache was written.
    mockFileExists.mockImplementation(async (p: string) => {
      return !p.includes("entities/bar.md")
    })

    const result = await checkIngestCache("/project", "foo.pdf", "hello")
    expect(result).toBeNull()
  })

  it("returns null when the content hash no longer matches (cache stale on content change)", async () => {
    let persisted = ""
    mockReadFile.mockImplementation(async () => persisted || JSON.stringify({ entries: {} }))
    mockWriteFile.mockImplementation(async (_p: string, c: string) => {
      persisted = c
    })
    await saveIngestCache("/project", "foo.pdf", "hello", ["wiki/sources/foo.md"])

    const result = await checkIngestCache("/project", "foo.pdf", "different content")
    expect(result).toBeNull()
  })

  it("returns null if fileExists itself throws (safer to re-ingest than to trust)", async () => {
    let persisted = ""
    mockReadFile.mockImplementation(async () => persisted || JSON.stringify({ entries: {} }))
    mockWriteFile.mockImplementation(async (_p: string, c: string) => {
      persisted = c
    })
    await saveIngestCache("/project", "foo.pdf", "hello", ["wiki/sources/foo.md"])

    mockFileExists.mockRejectedValue(new Error("stat failed"))

    const result = await checkIngestCache("/project", "foo.pdf", "hello")
    expect(result).toBeNull()
  })

  it("uses sourceKey + fingerprint so same-named files in different folders do not collide", async () => {
    let persisted = ""
    mockReadFile.mockImplementation(async () => persisted || JSON.stringify({ entries: {} }))
    mockWriteFile.mockImplementation(async (_p: string, c: string) => {
      persisted = c
    })

    const fpA: FileFingerprint = {
      sourcePath: "/project/raw/sources/a/foo.pdf",
      sourceKey: "raw/sources/a/foo.pdf",
      sizeBytes: 100,
      modifiedMs: 1000,
      generatedAt: "2026-05-21T00:00:00.000Z",
    }
    const fpB: FileFingerprint = {
      sourcePath: "/project/raw/sources/b/foo.pdf",
      sourceKey: "raw/sources/b/foo.pdf",
      sizeBytes: 200,
      modifiedMs: 2000,
      generatedAt: "2026-05-21T00:00:00.000Z",
    }

    await saveIngestCache("/project", "foo.pdf", "old-a", ["wiki/sources/a.md"], {
      sourceKey: fpA.sourceKey,
      sourceFingerprint: fpA,
      artifactManifestPath: ".llm-wiki/document-artifacts/a/manifest.json",
      completedStages: ["core"],
    })
    await saveIngestCache("/project", "foo.pdf", "old-b", ["wiki/sources/b.md"], {
      sourceKey: fpB.sourceKey,
      sourceFingerprint: fpB,
      artifactManifestPath: ".llm-wiki/document-artifacts/b/manifest.json",
      completedStages: ["core"],
    })

    mockFileExists.mockResolvedValue(true)

    await expect(
      checkIngestCache("/project", "foo.pdf", "changed text extraction is ignored on fingerprint hit", {
        sourceKey: fpA.sourceKey,
        sourceFingerprint: fpA,
      }),
    ).resolves.toEqual(["wiki/sources/a.md"])
    await expect(
      checkIngestCache("/project", "foo.pdf", "changed text extraction is ignored on fingerprint hit", {
        sourceKey: fpB.sourceKey,
        sourceFingerprint: fpB,
      }),
    ).resolves.toEqual(["wiki/sources/b.md"])

    const parsed = JSON.parse(persisted)
    expect(Object.keys(parsed.entries).sort()).toEqual([
      "raw/sources/a/foo.pdf",
      "raw/sources/b/foo.pdf",
    ])
  })

  it("returns detailed hit data for queue recovery while keeping legacy check compatible", async () => {
    let persisted = ""
    mockReadFile.mockImplementation(async () => persisted || JSON.stringify({ entries: {} }))
    mockWriteFile.mockImplementation(async (_p: string, c: string) => {
      persisted = c
    })
    const fingerprint: FileFingerprint = {
      sourcePath: "/project/raw/sources/a/foo.pdf",
      sourceKey: "raw/sources/a/foo.pdf",
      sizeBytes: 100,
      modifiedMs: 1000,
      generatedAt: "2026-05-21T00:00:00.000Z",
    }

    await saveIngestCache("/project", "foo.pdf", "hello", ["wiki/sources/foo.md"], {
      sourceKey: fingerprint.sourceKey,
      sourceFingerprint: fingerprint,
      completedStages: ["core", "postProcessing"],
    })
    mockFileExists.mockResolvedValue(true)

    const detailed = await checkIngestCacheDetailed("/project", "foo.pdf", "ignored after fingerprint", {
      sourceKey: fingerprint.sourceKey,
      sourceFingerprint: fingerprint,
    })
    const legacy = await checkIngestCache("/project", "foo.pdf", "ignored after fingerprint", {
      sourceKey: fingerprint.sourceKey,
      sourceFingerprint: fingerprint,
    })

    expect(detailed?.filesWritten).toEqual(["wiki/sources/foo.md"])
    expect(detailed?.entry).toMatchObject({
      sourceKey: "raw/sources/a/foo.pdf",
      completedStages: ["core", "postProcessing"],
    })
    expect(legacy).toEqual(["wiki/sources/foo.md"])
  })

  it("invalidates old spreadsheet cache entries so Excel files re-enter the structured parser", async () => {
    const fingerprint: FileFingerprint = {
      sourcePath: "/project/raw/sources/周计划zz.xlsx",
      sourceKey: "raw/sources/周计划zz.xlsx",
      sizeBytes: 123,
      modifiedMs: 1710000000000,
      generatedAt: "2026-05-21T00:00:00.000Z",
    }
    mockReadFile.mockResolvedValue(JSON.stringify({
      entries: {
        [fingerprint.sourceKey]: {
          hash: "legacy",
          timestamp: 1,
          filesWritten: ["wiki/sources/周计划zz.md"],
          sourceKey: fingerprint.sourceKey,
          sourceFileName: "周计划zz.xlsx",
          sourceFingerprint: fingerprint,
          pipelineVersion: 2,
        },
      },
    }))
    mockFileExists.mockResolvedValue(true)

    const hit = await checkIngestCache("/project", "周计划zz.xlsx", "", {
      sourceKey: fingerprint.sourceKey,
      sourceFingerprint: fingerprint,
    })

    expect(hit).toBeNull()
  })
})
