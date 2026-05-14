import type { SearchResult, ImageRef } from "@/lib/search"
import { getRelativePath, normalizePath } from "@/lib/path-utils"

export interface KnowledgeImageEvidence {
  imageId: string
  url: string
  alt: string
  caption: string
  sourcePageTitle: string
  sourcePagePath: string
  sourcePageIndex: number | null
  matchedReason: string
  score: number
}

export interface KnowledgeImageEvidencePage {
  title: string
  path: string
  content: string
}

const IMAGE_REF_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g

const VISUAL_INTENT_RE =
  /(主图|图片|图像|配图|细节图|案例图|案例|版式|构图|素材|视觉|对比|画面|截图|示例|样例|细节|设计|海报|封面|产品图|场景图|效果图)/i

export function hasVisualQuestionIntent(query: string): boolean {
  return VISUAL_INTENT_RE.test(query)
}

function tokenizeForImageEvidence(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .slice(0, 16)
}

function normalizeImageUrl(rawUrl: string, projectPath: string): string {
  const url = normalizePath(rawUrl.trim())
  if (!url) return url
  if (/^(https?:|data:|blob:|file:|tauri:)/i.test(url)) return url
  if (url.startsWith("wiki/")) return url.slice("wiki/".length)
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  if (url.startsWith(`${pp}/wiki/`)) return url.slice(`${pp}/wiki/`.length)
  return url.replace(/^\.\//, "")
}

function extractImageRefsFromMarkdown(content: string): ImageRef[] {
  const seen = new Set<string>()
  const out: ImageRef[] = []
  for (const match of content.matchAll(IMAGE_REF_RE)) {
    const url = match[2]?.trim()
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push({ url, alt: match[1]?.trim() ?? "" })
  }
  return out
}

function scoreImageEvidence(
  image: ImageRef,
  source: { title: string; path: string; resultScore?: number; titleMatch?: boolean },
  queryTokens: string[],
): { score: number; matchedReason: string } {
  const haystack = `${image.alt} ${source.title} ${source.path}`.toLowerCase()
  const matchedTokens = queryTokens.filter((token) => haystack.includes(token))
  let score = source.resultScore ?? 0
  if (source.titleMatch) score += 18
  if (matchedTokens.length > 0) score += 30 + matchedTokens.length * 6
  if (/主图|素材|版式|视觉|细节|案例|构图|设计/.test(image.alt)) score += 12
  if (source.path.includes("/business/")) score += 10
  if (source.path.includes("/sources/")) score += 6
  const matchedReason = matchedTokens.length > 0
    ? `图片说明或来源页命中：${matchedTokens.slice(0, 4).join("、")}`
    : source.titleMatch
      ? "来源页标题命中问题"
      : "来自本次检索命中的相关页面"
  return { score, matchedReason }
}

function pushEvidence(
  out: KnowledgeImageEvidence[],
  seen: Set<string>,
  image: ImageRef,
  source: {
    title: string
    path: string
    sourcePageIndex: number | null
    resultScore?: number
    titleMatch?: boolean
  },
  projectPath: string,
  queryTokens: string[],
): void {
  const url = normalizeImageUrl(image.url, projectPath)
  if (!url || seen.has(url)) return
  seen.add(url)
  const { score, matchedReason } = scoreImageEvidence(image, source, queryTokens)
  const caption = image.alt?.trim() || "原始文档中的图片案例"
  out.push({
    imageId: `img-${out.length + 1}`,
    url,
    alt: image.alt?.trim() ?? "",
    caption,
    sourcePageTitle: source.title,
    sourcePagePath: source.path,
    sourcePageIndex: source.sourcePageIndex,
    matchedReason,
    score,
  })
}

export function collectKnowledgeImageEvidence(
  query: string,
  searchResults: SearchResult[],
  relevantPages: KnowledgeImageEvidencePage[],
  projectPath: string,
  limit = 8,
): KnowledgeImageEvidence[] {
  if (!hasVisualQuestionIntent(query)) return []
  const pp = normalizePath(projectPath)
  const queryTokens = tokenizeForImageEvidence(query)
  const seen = new Set<string>()
  const out: KnowledgeImageEvidence[] = []
  const pageIndexByPath = new Map<string, number>()

  relevantPages.forEach((page, index) => {
    pageIndexByPath.set(normalizePath(page.path), index + 1)
  })

  for (const result of searchResults) {
    const sourcePath = getRelativePath(result.path, pp)
    for (const image of result.images) {
      pushEvidence(out, seen, image, {
        title: result.title,
        path: sourcePath,
        sourcePageIndex: pageIndexByPath.get(normalizePath(sourcePath)) ?? null,
        resultScore: result.score,
        titleMatch: result.titleMatch,
      }, projectPath, queryTokens)
    }
  }

  for (const page of relevantPages) {
    for (const image of extractImageRefsFromMarkdown(page.content)) {
      pushEvidence(out, seen, image, {
        title: page.title,
        path: page.path,
        sourcePageIndex: pageIndexByPath.get(normalizePath(page.path)) ?? null,
        resultScore: 0,
        titleMatch: false,
      }, projectPath, queryTokens)
    }
  }

  return out
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item, index) => ({ ...item, imageId: `img-${index + 1}` }))
}

export function buildKnowledgeImageEvidenceContext(
  evidence: KnowledgeImageEvidence[],
): string {
  if (evidence.length === 0) return ""
  return evidence.map((item) => {
    const pageRef = item.sourcePageIndex ? `[${item.sourcePageIndex}]` : "未进入正文页列表"
    return [
      `### ${item.imageId}`,
      `Markdown: ![${item.caption}](${item.url})`,
      `Caption: ${item.caption}`,
      `Source: ${item.sourcePageTitle} (${item.sourcePagePath}, ${pageRef})`,
      `Why relevant: ${item.matchedReason}`,
    ].join("\n")
  }).join("\n\n")
}
