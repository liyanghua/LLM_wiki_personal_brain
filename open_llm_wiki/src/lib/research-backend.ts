import type { SearchApiConfig } from "@/stores/wiki-store"
import { getHttpFetch, isFetchNetworkError } from "@/lib/tauri-fetch"
import { webSearch, type WebSearchResult } from "@/lib/web-search"

export interface ResearchBackendResult {
  query: string
  results: WebSearchResult[]
  degraded: boolean
  detail: string
  provider: "firecrawl" | "tavily" | "none"
  blocked: boolean
}

export interface FetchedResearchDocument {
  url: string
  title: string
  markdown: string
  degraded: boolean
  detail: string
  provider: "firecrawl" | "tavily" | "none"
  blocked: boolean
}

function effectiveFirecrawlBaseUrl(config: SearchApiConfig): string {
  return (config.firecrawlBaseUrl?.trim() || "https://api.firecrawl.dev").replace(/\/$/, "")
}

export async function runResearchSearch(
  query: string,
  config: SearchApiConfig,
  maxResults: number = 5,
): Promise<ResearchBackendResult> {
  const provider = (config.researchProvider ?? "firecrawl") as "firecrawl" | "tavily" | "none"
  if (provider === "firecrawl") {
    try {
      const results = await firecrawlSearch(query, config, maxResults)
      return {
        query,
        results,
        degraded: false,
        detail: "已通过 Firecrawl 搜索并准备进一步抓取正文。",
        provider: "firecrawl",
        blocked: false,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const tavilyApiKey = config.apiKey?.trim()
      if (!tavilyApiKey) {
        return {
          query,
          results: [],
          degraded: false,
          detail: `Firecrawl 不可用，且当前没有 Tavily 可降级：${message}`,
          provider: "firecrawl",
          blocked: true,
        }
      }
      const fallback = await webSearch(query, {
        provider: "tavily",
        apiKey: tavilyApiKey,
        researchProvider: "tavily",
        firecrawlApiKey: config.firecrawlApiKey,
        firecrawlBaseUrl: config.firecrawlBaseUrl,
        runtimeFirecrawlApiKey: config.runtimeFirecrawlApiKey,
      }, maxResults)
      return {
        query,
        results: fallback,
        degraded: true,
        detail: `Firecrawl 不可用，已降级到 Tavily-only 检索：${message}`,
        provider: "tavily",
        blocked: false,
      }
    }
  }

  if (provider === "tavily" && !config.apiKey?.trim()) {
    return {
      query,
      results: [],
      degraded: false,
      detail: "当前研究后端设置为 Tavily，但未配置 Tavily API Key。",
      provider: "tavily",
      blocked: true,
    }
  }

  if (provider === "none") {
    return {
      query,
      results: [],
      degraded: false,
      detail: "当前研究后端已禁用，无法执行外部研究。",
      provider: "none",
      blocked: true,
    }
  }

  const results = await webSearch(query, config, maxResults)
  return {
    query,
    results,
    degraded: false,
    detail: "当前研究会话使用 Tavily 作为搜索后端。",
    provider: "tavily",
    blocked: false,
  }
}

export async function fetchResearchDocument(
  url: string,
  title: string,
  config: SearchApiConfig,
): Promise<FetchedResearchDocument> {
  const provider = config.researchProvider ?? "firecrawl"
  if (provider !== "firecrawl") {
    return {
      url,
      title,
      markdown: "",
      degraded: true,
      detail: "当前研究会话未启用 Firecrawl 抓取，仅保留搜索摘要。",
      provider: "tavily",
      blocked: false,
    }
  }

  const httpFetch = await getHttpFetch()
  const baseUrl = effectiveFirecrawlBaseUrl(config)
  const apiKey = config.firecrawlApiKey?.trim() || config.runtimeFirecrawlApiKey?.trim()
  if (!apiKey) {
    return {
      url,
      title,
      markdown: "",
      degraded: true,
      detail: "Firecrawl API Key 缺失，未抓取整页正文。",
      provider: "firecrawl",
      blocked: true,
    }
  }

  let response: Response
  try {
    response = await httpFetch(`${baseUrl}/v1/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
      }),
    })
  } catch (err) {
    if (isFetchNetworkError(err)) {
      return {
        url,
        title,
        markdown: "",
        degraded: true,
        detail: "抓取整页正文时网络异常，已保留搜索摘要。",
        provider: "firecrawl",
        blocked: false,
      }
    }
    throw err
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "Unknown error")
    return {
      url,
      title,
      markdown: "",
      degraded: true,
      detail: `Firecrawl 抓取失败 (${response.status})：${detail}`,
      provider: "firecrawl",
      blocked: false,
    }
  }

  const data = await response.json() as {
    markdown?: string
    data?: {
      markdown?: string
      metadata?: {
        title?: string
      }
    }
  }

  const markdown = data.markdown ?? data.data?.markdown ?? ""
  return {
    url,
    title: data.data?.metadata?.title || title,
    markdown,
    degraded: markdown.trim().length === 0,
    detail: markdown.trim().length > 0
      ? "已抓取整页正文。"
      : "Firecrawl 返回为空，当前只保留搜索摘要。",
    provider: "firecrawl",
    blocked: false,
  }
}

async function firecrawlSearch(
  query: string,
  config: SearchApiConfig,
  maxResults: number,
): Promise<WebSearchResult[]> {
  const httpFetch = await getHttpFetch()
  const apiKey = config.firecrawlApiKey?.trim() || config.runtimeFirecrawlApiKey?.trim()
  if (!apiKey) {
    throw new Error("Firecrawl API Key 未配置。")
  }

  const baseUrl = effectiveFirecrawlBaseUrl(config)
  let response: Response
  try {
    response = await httpFetch(`${baseUrl}/v1/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        limit: maxResults,
      }),
    })
  } catch (err) {
    if (isFetchNetworkError(err)) {
      throw new Error("无法连接 Firecrawl 搜索服务。")
    }
    throw err
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "Unknown error")
    throw new Error(`Firecrawl search failed (${response.status}): ${detail}`)
  }

  const data = await response.json() as {
    data?: Array<{
      url?: string
      title?: string
      description?: string
      markdown?: string
    }>
    results?: Array<{
      url?: string
      title?: string
      description?: string
      content?: string
    }>
  }

  const list = (data.data ?? data.results ?? []).slice(0, maxResults) as Array<{
    url?: string
    title?: string
    description?: string
    content?: string
    markdown?: string
  }>
  return list.map((item) => ({
    title: item.title ?? "Untitled",
    url: item.url ?? "",
    snippet: item.description ?? item.content ?? item.markdown ?? "",
    source: (() => {
      try {
        return new URL(item.url ?? "").hostname.replace("www.", "")
      } catch {
        return "web"
      }
    })(),
  })).filter((item) => item.url)
}
