import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  analyzeDocumentWithBackend: vi.fn(),
  convertDocToDocx: vi.fn(),
  createDirectory: vi.fn(),
  fileFingerprint: vi.fn(),
  preprocessFile: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

vi.mock("@/lib/pdf-enhanced", () => ({
  preparePdfForIngest: vi.fn(),
}))

import { analyzeDocumentWithBackend, createDirectory, fileFingerprint, preprocessFile, readFile, writeFile } from "@/commands/fs"
import { detectSourceKind, prepareDocumentForIngest } from "./document-preparation"
import type { FileFingerprint } from "./ingest-cache"

const mockAnalyze = vi.mocked(analyzeDocumentWithBackend)
const mockCreateDirectory = vi.mocked(createDirectory)
const mockFileFingerprint = vi.mocked(fileFingerprint)
const mockPreprocessFile = vi.mocked(preprocessFile)
const mockReadFile = vi.mocked(readFile)
const mockWriteFile = vi.mocked(writeFile)

describe("detectSourceKind", () => {
  it("classifies spreadsheets as structured sources instead of generic text", () => {
    expect(detectSourceKind("/project/raw/sources/周计划zz.xlsx")).toBe("xlsx")
    expect(detectSourceKind("/project/raw/sources/绩效考核表.xls")).toBe("xls")
    expect(detectSourceKind("/project/raw/sources/计划表.ods")).toBe("ods")
  })
})

describe("prepareDocumentForIngest artifact reuse", () => {
  beforeEach(() => {
    mockAnalyze.mockReset()
    mockCreateDirectory.mockReset()
    mockFileFingerprint.mockReset()
    mockPreprocessFile.mockReset()
    mockReadFile.mockReset()
    mockWriteFile.mockReset()
    mockCreateDirectory.mockResolvedValue(undefined as unknown as void)
    mockFileFingerprint.mockResolvedValue({
      sourcePath: "/project/.llm-wiki/document-artifacts/task-doc/artifact",
      sizeBytes: 128,
      modifiedMs: 1710000000000,
    })
    mockWriteFile.mockResolvedValue(undefined as unknown as void)
    mockPreprocessFile.mockResolvedValue([
      "## Sheet1",
      "",
      "| 执行人 | 计划节点/具体事项 |",
      "| --- | --- |",
      "| 曾钊 | 直通车计划调优 |",
    ].join("\n"))
  })

  it("reuses document artifacts when source fingerprint and prepare options match", async () => {
    const sourceFingerprint: FileFingerprint = {
      sourcePath: "/project/raw/sources/task.md",
      sourceKey: "raw/sources/task.md",
      sizeBytes: 128,
      modifiedMs: 1710000000000,
      generatedAt: "2026-05-21T00:00:00.000Z",
    }
    mockReadFile.mockImplementation(async (path: string) => {
      if (path.endsWith("/manifest.json")) {
        return JSON.stringify({
          docId: "task-doc",
          sourcePath: sourceFingerprint.sourcePath,
          sourceKind: "generic",
          backend: "generic",
          generatedAt: "2026-05-21T00:00:00.000Z",
          outputDir: "/project/.llm-wiki/document-artifacts/task-doc",
          analysisPath: "/project/.llm-wiki/document-artifacts/task-doc/analysis.md",
          markdownPath: "/project/.llm-wiki/document-artifacts/task-doc/source.md",
          jsonPath: null,
          htmlPath: null,
          normalizedPath: "/project/.llm-wiki/document-artifacts/task-doc/normalized.json",
          documentIrPath: "/project/.llm-wiki/document-artifacts/task-doc/document-ir.json",
          pageCount: null,
          ocrUsed: false,
          degraded: false,
          detail: "ready",
          warnings: [],
          artifactSchemaVersion: 2,
          prepareOptionsSignature: JSON.stringify({
            preferredPdfBackend: "pdfium",
            multimodalEnabled: false,
            multimodalAvailable: false,
            sourceKind: "generic",
          }),
          sourceFingerprint,
        })
      }
      if (path.endsWith("/analysis.md")) return "# Cached analysis"
      if (path.endsWith("/normalized.json")) {
        return JSON.stringify({
          sourceKind: "generic",
          sourcePath: sourceFingerprint.sourcePath,
          analysisMarkdown: "# Cached analysis",
          plainText: "Cached analysis",
          headings: [],
          tables: [],
          images: [],
          revisionMarks: [],
          mindmapNodes: [],
          sourceAnchors: [],
          sopSteps: [],
          businessRules: [],
          decisionPoints: [],
          entityCandidates: [],
          missingFieldKeys: [],
          mindmapSummary: [],
          warnings: [],
        })
      }
      if (path.endsWith("/document-ir.json")) {
        return JSON.stringify({
          docId: "task-doc",
          sourcePath: sourceFingerprint.sourcePath,
          sourceName: "task.md",
          sourceKind: "generic",
          blocks: [],
          tables: [],
          images: [],
          anchors: [],
          warnings: [],
        })
      }
      throw new Error(`Unexpected read: ${path}`)
    })

    const result = await prepareDocumentForIngest("/project", sourceFingerprint.sourcePath, {
      preferredPdfBackend: "pdfium",
      multimodalEnabled: false,
      multimodalAvailable: false,
      sourceFingerprint,
      allowArtifactReuse: true,
    })

    expect(result.analysisMarkdown).toBe("# Cached analysis")
    expect(result.artifactManifest?.sourceFingerprint).toEqual(sourceFingerprint)
    expect(mockAnalyze).not.toHaveBeenCalled()
  })

  it("does not reuse old generic artifacts for spreadsheets", async () => {
    const sourceFingerprint: FileFingerprint = {
      sourcePath: "/project/raw/sources/task.xlsx",
      sourceKey: "raw/sources/task.xlsx",
      sizeBytes: 128,
      modifiedMs: 1710000000000,
      generatedAt: "2026-05-21T00:00:00.000Z",
    }
    mockReadFile.mockImplementation(async (path: string) => {
      if (path.endsWith("/manifest.json")) {
        return JSON.stringify({
          docId: "task-doc",
          sourcePath: sourceFingerprint.sourcePath,
          sourceKind: "generic",
          backend: "generic",
          generatedAt: "2026-05-21T00:00:00.000Z",
          outputDir: "/project/.llm-wiki/document-artifacts/task-doc",
          analysisPath: "/project/.llm-wiki/document-artifacts/task-doc/analysis.md",
          markdownPath: "/project/.llm-wiki/document-artifacts/task-doc/source.md",
          jsonPath: null,
          htmlPath: null,
          normalizedPath: "/project/.llm-wiki/document-artifacts/task-doc/normalized.json",
          documentIrPath: "/project/.llm-wiki/document-artifacts/task-doc/document-ir.json",
          pageCount: null,
          ocrUsed: false,
          degraded: false,
          detail: "ready",
          warnings: [],
          artifactSchemaVersion: 2,
          prepareOptionsSignature: JSON.stringify({
            preferredPdfBackend: "pdfium",
            multimodalEnabled: false,
            multimodalAvailable: false,
            sourceKind: "generic",
          }),
          sourceFingerprint,
        })
      }
      throw new Error(`Unexpected read: ${path}`)
    })
    const result = await prepareDocumentForIngest("/project", sourceFingerprint.sourcePath, {
      preferredPdfBackend: "pdfium",
      multimodalEnabled: false,
      multimodalAvailable: false,
      sourceFingerprint,
      allowArtifactReuse: true,
    })

    expect(result.sourceKind).toBe("xlsx")
    expect(result.backendStatus.mode).toBe("spreadsheet_core")
    expect(result.analysisMarkdown).toContain("直通车计划调优")
    expect(mockPreprocessFile).toHaveBeenCalledWith(sourceFingerprint.sourcePath)
    expect(mockAnalyze).not.toHaveBeenCalled()
  })
})
