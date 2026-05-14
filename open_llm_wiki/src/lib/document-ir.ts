import { getFileName, getFileStem, getRelativePath, normalizePath } from "@/lib/path-utils"
import type { DocumentBlock, DocumentIR } from "@/lib/agent-mode-types"

function simpleHash(input: string): string {
  let hash = 5381
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i)
  }
  return Math.abs(hash >>> 0).toString(36)
}

function makeDocId(sourcePath: string, projectPath?: string): string {
  const rel = projectPath ? getRelativePath(sourcePath, projectPath) : sourcePath
  const stem = getFileStem(rel)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return `${stem || "document"}-${simpleHash(rel).slice(0, 6)}`
}

function makeBlockId(docId: string, index: number): string {
  return `${docId}-b${String(index).padStart(3, "0")}`
}

interface DraftBlock {
  blockType: DocumentBlock["blockType"]
  textContent: string
  lineStart: number
  lineEnd: number
  level?: number
  headingPath: string[]
}

export function buildDocumentIR(
  projectPath: string,
  sourcePath: string,
  sourceContent: string,
): DocumentIR {
  const pp = normalizePath(projectPath)
  const sp = normalizePath(sourcePath)
  const docId = makeDocId(sp, pp)
  const lines = sourceContent.replace(/\r\n/g, "\n").split("\n")
  const blocks: DraftBlock[] = []
  const headingStack: { level: number; text: string }[] = []

  let paragraphLines: string[] = []
  let paragraphStart = 0
  let listLines: string[] = []
  let listStart = 0
  let codeLines: string[] = []
  let codeStart = 0
  let tableLines: string[] = []
  let tableStart = 0
  let inCodeFence = false

  function currentHeadingPath(): string[] {
    return headingStack.map((item) => item.text)
  }

  function flushParagraph(endLine: number) {
    if (paragraphLines.length === 0) return
    blocks.push({
      blockType: "paragraph",
      textContent: paragraphLines.join("\n").trim(),
      lineStart: paragraphStart,
      lineEnd: endLine,
      headingPath: currentHeadingPath(),
    })
    paragraphLines = []
  }

  function flushList(endLine: number) {
    if (listLines.length === 0) return
    blocks.push({
      blockType: "list",
      textContent: listLines.join("\n").trim(),
      lineStart: listStart,
      lineEnd: endLine,
      headingPath: currentHeadingPath(),
    })
    listLines = []
  }

  function flushTable(endLine: number) {
    if (tableLines.length === 0) return
    blocks.push({
      blockType: "table",
      textContent: tableLines.join("\n").trim(),
      lineStart: tableStart,
      lineEnd: endLine,
      headingPath: currentHeadingPath(),
    })
    tableLines = []
  }

  function flushCode(endLine: number) {
    if (codeLines.length === 0) return
    blocks.push({
      blockType: "code",
      textContent: codeLines.join("\n"),
      lineStart: codeStart,
      lineEnd: endLine,
      headingPath: currentHeadingPath(),
    })
    codeLines = []
  }

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1
    const raw = lines[i]
    const trimmed = raw.trim()

    if (/^```/.test(trimmed)) {
      flushParagraph(lineNo - 1)
      flushList(lineNo - 1)
      flushTable(lineNo - 1)
      if (!inCodeFence) {
        inCodeFence = true
        codeStart = lineNo
        codeLines.push(raw)
      } else {
        codeLines.push(raw)
        flushCode(lineNo)
        inCodeFence = false
      }
      continue
    }

    if (inCodeFence) {
      codeLines.push(raw)
      continue
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      flushParagraph(lineNo - 1)
      flushList(lineNo - 1)
      flushTable(lineNo - 1)
      const level = headingMatch[1].length
      const text = headingMatch[2].trim()
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop()
      }
      headingStack.push({ level, text })
      blocks.push({
        blockType: "heading",
        textContent: text,
        lineStart: lineNo,
        lineEnd: lineNo,
        level,
        headingPath: currentHeadingPath(),
      })
      continue
    }

    if (!trimmed) {
      flushParagraph(lineNo - 1)
      flushList(lineNo - 1)
      flushTable(lineNo - 1)
      continue
    }

    if (/^>\s?/.test(trimmed)) {
      flushParagraph(lineNo - 1)
      flushList(lineNo - 1)
      flushTable(lineNo - 1)
      blocks.push({
        blockType: "quote",
        textContent: trimmed.replace(/^>\s?/, ""),
        lineStart: lineNo,
        lineEnd: lineNo,
        headingPath: currentHeadingPath(),
      })
      continue
    }

    if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      flushParagraph(lineNo - 1)
      flushTable(lineNo - 1)
      if (listLines.length === 0) listStart = lineNo
      listLines.push(trimmed)
      continue
    }

    if (trimmed.includes("|") && /\|/.test(trimmed)) {
      flushParagraph(lineNo - 1)
      flushList(lineNo - 1)
      if (tableLines.length === 0) tableStart = lineNo
      tableLines.push(raw)
      continue
    }

    if (paragraphLines.length === 0) paragraphStart = lineNo
    paragraphLines.push(raw)
  }

  flushParagraph(lines.length)
  flushList(lines.length)
  flushTable(lines.length)
  flushCode(lines.length)

  const normalizedBlocks: DocumentBlock[] = blocks.map((block, index) => ({
    blockId: makeBlockId(docId, index + 1),
    blockType: block.blockType,
    textContent: block.textContent,
    parentBlockId: null,
    childBlockIds: [],
    sourceRefs: [sp],
    headingPath: block.headingPath,
    level: block.level,
    lineStart: block.lineStart,
    lineEnd: block.lineEnd,
  }))

  let latestHeadingByLevel = new Map<number, string>()
  normalizedBlocks.forEach((block) => {
    if (block.blockType === "heading") {
      latestHeadingByLevel = new Map(
        Array.from(latestHeadingByLevel.entries()).filter(([level]) => level < (block.level ?? 7)),
      )
      latestHeadingByLevel.set(block.level ?? 1, block.blockId)
      const parentLevel = Math.max(...Array.from(latestHeadingByLevel.keys()).filter((level) => level < (block.level ?? 1)), 0)
      block.parentBlockId = parentLevel > 0 ? latestHeadingByLevel.get(parentLevel) ?? null : null
    } else {
      const nearestLevel = Math.max(...Array.from(latestHeadingByLevel.keys()), 0)
      block.parentBlockId = nearestLevel > 0 ? latestHeadingByLevel.get(nearestLevel) ?? null : null
    }
  })

  const byId = new Map(normalizedBlocks.map((block) => [block.blockId, block]))
  normalizedBlocks.forEach((block) => {
    if (block.parentBlockId) {
      byId.get(block.parentBlockId)?.childBlockIds.push(block.blockId)
    }
  })

  return {
    docId,
    sourceName: getFileName(sp),
    sourcePath: sp,
    createdAt: new Date().toISOString(),
    blocks: normalizedBlocks,
  }
}
