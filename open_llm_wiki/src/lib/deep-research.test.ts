import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { realFs, createTempProject, readFileRaw } from "@/test-helpers/fs-temp"
import { useResearchStore } from "@/stores/research-store"
import { useWikiStore, type LlmConfig, type SearchApiConfig } from "@/stores/wiki-store"

vi.mock("@/commands/fs", () => realFs)

vi.mock("@/lib/llm-client", () => ({
  streamChat: vi.fn(),
}))

vi.mock("@/lib/research-backend", () => ({
  runResearchSearch: vi.fn(),
  fetchResearchDocument: vi.fn(),
}))

import { enterResearchWorkbench, runDeepResearchSession } from "@/lib/deep-research"
import { streamChat } from "@/lib/llm-client"
import { fetchResearchDocument, runResearchSearch } from "@/lib/research-backend"

const mockStreamChat = vi.mocked(streamChat)
const mockRunResearchSearch = vi.mocked(runResearchSearch)
const mockFetchResearchDocument = vi.mocked(fetchResearchDocument)

function fakeLlmConfig(): LlmConfig {
  return {
    provider: "openai",
    apiKey: "test-key",
    model: "gpt-4o-mini",
    ollamaUrl: "",
    customEndpoint: "",
    maxContextSize: 128000,
  }
}

function fakeSearchConfig(): SearchApiConfig {
  return {
    provider: "tavily",
    apiKey: "test-search-key",
    researchProvider: "tavily",
    firecrawlApiKey: "",
    firecrawlBaseUrl: "https://api.firecrawl.dev",
    runtimeFirecrawlApiKey: "",
  }
}

function setupProject(projectPath: string) {
  useWikiStore.getState().setProject({ id: "project-1", name: "Test Project", path: projectPath })
  useWikiStore.getState().setLlmConfig(fakeLlmConfig())
  useWikiStore.getState().setSearchApiConfig(fakeSearchConfig())
  useWikiStore.getState().setOutputLanguage("auto")
  useResearchStore.getState().reset()
}

function mockResearchBackend() {
  mockRunResearchSearch.mockImplementation(async (query) => ({
    query,
    provider: "tavily",
    blocked: false,
    degraded: false,
    detail: "已完成测试搜索。",
    results: [
      {
        title: `Source for ${query}`,
        url: `https://example.com/${encodeURIComponent(query)}`,
        snippet: `${query} evidence summary`,
        source: "example.com",
      },
    ],
  }))
  mockFetchResearchDocument.mockImplementation(async (url, title) => ({
    url,
    title,
    markdown: `# ${title}\n\nThis source contains concrete evidence for the research topic.`,
    provider: "tavily",
    blocked: false,
    degraded: false,
    detail: "已抓取测试正文。",
  }))
}

function systemPromptOf(messages: Parameters<typeof streamChat>[1]): string {
  return String(messages[0]?.content ?? "")
}

function hasReachedReportSynthesis(): boolean {
  return mockStreamChat.mock.calls.some(([, messages]) => systemPromptOf(messages).includes("总结助手"))
}

function mockStreamUntilReportFails(message: string) {
  mockStreamChat.mockImplementation(async (_config, messages, callbacks) => {
    const systemPrompt = systemPromptOf(messages)
    if (systemPrompt.includes("总结助手")) {
      callbacks.onError(new Error(message))
      return
    }
    if (systemPrompt.includes("证据提炼助手")) {
      callbacks.onToken(JSON.stringify({
        learnedFacts: ["测试来源支持这个研究判断。"],
        openFollowUps: [],
        sourceReliabilityNote: "测试来源。",
      }))
      callbacks.onDone()
      return
    }
    callbacks.onToken("[]")
    callbacks.onDone()
  })
}

function mockStreamUntilReportNeverFinishes() {
  mockStreamChat.mockImplementation(async (_config, messages, callbacks) => {
    const systemPrompt = systemPromptOf(messages)
    if (systemPrompt.includes("总结助手")) {
      return new Promise<void>(() => {})
    }
    if (systemPrompt.includes("证据提炼助手")) {
      callbacks.onToken(JSON.stringify({
        learnedFacts: ["测试来源支持这个研究判断。"],
        openFollowUps: [],
        sourceReliabilityNote: "测试来源。",
      }))
      callbacks.onDone()
      return
    }
    callbacks.onToken("[]")
    callbacks.onDone()
  })
}

async function createSeededResearchSession(projectPath: string): Promise<string> {
  setupProject(projectPath)
  mockResearchBackend()
  return enterResearchWorkbench({
    topic: "AI 主图设计工具",
    searchQueries: ["AI 主图设计工具 市场", "AI 主图设计工具 案例"],
    breadth: 1,
    depth: 1,
    triggerSource: "test",
  })
}

describe("runDeepResearchSession report synthesis observability", () => {
  beforeEach(() => {
    vi.useRealTimers()
    mockStreamChat.mockReset()
    mockRunResearchSearch.mockReset()
    mockFetchResearchDocument.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    useResearchStore.getState().reset()
    useWikiStore.getState().setProject(null)
  })

  it("writes an error state and fallback report when report synthesis fails", async () => {
    const tmp = await createTempProject("deep-research-report-error")
    try {
      const sessionId = await createSeededResearchSession(tmp.path)
      mockStreamUntilReportFails("model hung while synthesizing report")

      await runDeepResearchSession(sessionId, tmp.path)

      const session = useResearchStore.getState().sessions.find((item) => item.sessionId === sessionId)
      expect(session?.status).toBe("error")
      expect(session?.phase).toBe("synthesize_report")
      expect(session?.runtime.errorMessage).toContain("model hung")
      expect(session?.reportMarkdown).toContain("兜底")
      expect(session?.thread.some((entry) => entry.kind === "error" && entry.phase === "synthesize_report")).toBe(true)

      const saved = JSON.parse(await readFileRaw(session!.sessionPath!))
      expect(saved.status).toBe("error")
      expect(saved.runtime.errorMessage).toContain("model hung")
      expect(saved.reportMarkdown).toContain("测试来源支持这个研究判断")
    } finally {
      await tmp.cleanup()
    }
  })

  it("times out report synthesis and persists a visible fallback instead of hanging", async () => {
    vi.useFakeTimers()
    const tmp = await createTempProject("deep-research-report-timeout")
    try {
      const sessionId = await createSeededResearchSession(tmp.path)
      mockStreamUntilReportNeverFinishes()

      const runPromise = runDeepResearchSession(sessionId, tmp.path)
      await vi.waitFor(() => {
        expect(hasReachedReportSynthesis()).toBe(true)
      })
      await vi.advanceTimersByTimeAsync(95_000)
      await runPromise

      const session = useResearchStore.getState().sessions.find((item) => item.sessionId === sessionId)
      expect(session?.status).toBe("error")
      expect(session?.runtime.errorMessage).toContain("超过")
      expect(session?.reportMarkdown).toContain("兜底")
    } finally {
      await tmp.cleanup()
    }
  })
})
