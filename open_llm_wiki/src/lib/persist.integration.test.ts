/**
 * Tier 4 — real-FS integration tests for persistence.
 *
 * Tests exercise saveReviewItems / loadReviewItems and saveChatHistory /
 * loadChatHistory against a REAL filesystem (temp dir per test). Mocks only
 * the Tauri invoke boundary — Node fs is the real deal. This catches bugs
 * that memory mocks can't: Unicode path handling, JSON escape round-trip,
 * directory auto-creation, legacy-format fallback.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { realFs, createTempProject, readFileRaw, writeFileRaw, fileExists } from "@/test-helpers/fs-temp"
import type { ReviewItem } from "@/stores/review-store"
import type { Conversation, DisplayMessage } from "@/stores/chat-store"
import type { AgentLoopSession } from "@/lib/agent-mode-types"
import type { ResearchSession } from "@/lib/research-types"

vi.mock("@/commands/fs", () => realFs)

import {
  saveReviewItems,
  loadReviewItems,
  saveChatHistory,
  loadChatHistory,
} from "./persist"
import {
  loadAgentLoopSessions,
  saveAgentLoopSession,
} from "./agent-mode-persist"
import { saveResearchSession } from "./research-persist"

let tmp: { path: string; cleanup: () => Promise<void> }

function makeReview(overrides: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id: "r-1",
    type: "missing-page",
    title: "Attention",
    description: "",
    options: [],
    resolved: false,
    createdAt: 0,
    ...overrides,
  }
}

beforeEach(async () => {
  tmp = await createTempProject("persist")
})

afterEach(async () => {
  await tmp.cleanup()
})

describe("review persistence — round-trip", () => {
  it("save then load returns identical items", async () => {
    const items: ReviewItem[] = [
      makeReview({ id: "r-1", title: "Alpha" }),
      makeReview({ id: "r-2", title: "Beta", type: "duplicate" }),
    ]
    await saveReviewItems(tmp.path, items)
    const loaded = await loadReviewItems(tmp.path)
    expect(loaded).toEqual(items)
  })

  it("creates the .llm-wiki directory on first save", async () => {
    expect(await fileExists(`${tmp.path}/.llm-wiki`)).toBe(false)
    await saveReviewItems(tmp.path, [makeReview()])
    expect(await fileExists(`${tmp.path}/.llm-wiki/review.json`)).toBe(true)
  })

  it("returns empty array when the file is absent", async () => {
    const loaded = await loadReviewItems(tmp.path)
    expect(loaded).toEqual([])
  })

  it("returns empty array when the file is corrupted JSON", async () => {
    await writeFileRaw(`${tmp.path}/.llm-wiki/review.json`, "{not valid json")
    const loaded = await loadReviewItems(tmp.path)
    expect(loaded).toEqual([])
  })

  it("preserves Unicode titles through JSON round-trip", async () => {
    const items = [
      makeReview({ id: "r-zh", title: "注意力机制", description: "Transformer 核心" }),
      makeReview({ id: "r-ja", title: "これは日本語" }),
      makeReview({ id: "r-emoji", title: "Edge 🔥 case" }),
    ]
    await saveReviewItems(tmp.path, items)
    const loaded = await loadReviewItems(tmp.path)
    expect(loaded).toEqual(items)
    expect(loaded[0].title).toBe("注意力机制")
  })

  it("overwrites existing file on subsequent saves", async () => {
    await saveReviewItems(tmp.path, [makeReview({ id: "r-1", title: "Old" })])
    await saveReviewItems(tmp.path, [makeReview({ id: "r-2", title: "New" })])
    const loaded = await loadReviewItems(tmp.path)
    expect(loaded).toHaveLength(1)
    expect(loaded[0].title).toBe("New")
  })

  it("normalizes Windows-style paths (backslashes) in projectPath", async () => {
    // projectPath may arrive with backslashes on Windows. Use a forward-slash
    // tmp path (already normalized) but also double up slashes to confirm
    // the helpers survive unusual input.
    const windowsy = tmp.path.replace(/\//g, "\\")
    await saveReviewItems(windowsy, [makeReview({ id: "r-1" })])
    const loaded = await loadReviewItems(windowsy)
    expect(loaded).toHaveLength(1)
  })
})

describe("agent loop persistence — round-trip", () => {
  it("saves and loads loop session by doc id", async () => {
    const session: AgentLoopSession = {
      loopId: "loop-1",
      docId: "doc-a",
      status: "active",
      triggerSource: "manual_start",
      iteration: 2,
      activeTaskId: "task-1",
      activeCardId: "card-1",
      completedCardIds: ["card-0"],
      deferredCardIds: ["card-9"],
      feedbackTaskIds: [],
      lastRecomputeAt: null,
      lastRecomputeMode: "partial",
      startedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z",
      recommendedValidationQuestion: "现在这份文档是否已经讲清楚判断标准？",
      tasks: [
        {
          taskId: "task-1",
          taskType: "revision_card",
          docId: "doc-a",
          linkedCardId: "card-1",
          linkedLintIssueId: null,
          targetFieldKey: "judgment_criteria",
          priority: "high",
          status: "active",
          entryHint: "优先补齐判断标准",
          whyNow: "这是阻塞发布的关键缺口。",
        },
      ],
    }

    await saveAgentLoopSession(tmp.path, session)
    const loaded = await loadAgentLoopSessions(tmp.path)
    expect(loaded).toEqual([session])
  })
})

describe("research persistence — opportunity cards", () => {
  it("writes opportunity-cards.json for market opportunity sessions", async () => {
    const session: ResearchSession = {
      sessionId: "research-session-1",
      topic: "AI 主图设计工具市场机会",
      projectPath: tmp.path,
      taskType: "market_opportunity_analysis",
      businessContext: "面向电商运营团队",
      targetMarket: "中小电商",
      targetAudience: "运营负责人",
      constraints: null,
      linkedDocId: null,
      targetFieldKey: null,
      triggerSource: "market_opportunity_analysis",
      breadth: 3,
      depth: 2,
      focus: null,
      status: "done",
      phase: "save_research_asset",
      createdAt: 1,
      updatedAt: 2,
      followUpQuestions: [],
      userAnswers: [],
      plannedQueries: [],
      sources: [],
      learnings: [],
      pendingFollowUps: [],
      reportMarkdown: "report",
      notesMarkdown: "",
      findings: [],
      opportunityCards: [
        {
          cardId: "card-1",
          title: "主图测试助理",
          targetSegment: "中小电商运营团队",
          painPoint: "缺少持续测试能力",
          opportunityHypothesis: "把生成与验证闭环结合",
          evidenceSummary: "行业报告指出测试能力不足。",
          sourceUrls: ["https://example.com"],
          competitorSignals: ["竞品偏生成"],
          risks: ["流量不足"],
          validationExperiments: ["20 个 SKU A/B 测试"],
          confidence: 0.7,
          status: "draft",
          researchSessionId: "research-session-1",
          linkedDocId: null,
          targetFieldKey: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      reportSections: null,
      thread: [],
      visitedQueries: [],
      currentRound: 2,
      providerStatus: null,
      runtime: {
        sessionId: "research-session-1",
        phase: "save_research_asset",
        status: "done",
        title: "研究已完成",
        detail: "done",
        currentRound: 2,
        maxDepth: 2,
        providerStatus: null,
        visitedUrls: [],
        learnings: [],
        followUpQuestions: [],
        pendingUserAnswers: [],
        currentQueries: [],
        acceptedSourcesCount: 0,
        completedArtifacts: [],
        errorMessage: null,
        canResume: true,
      },
      artifactDir: null,
      reportPath: null,
      sessionPath: null,
      sourcesPath: null,
      notesPath: null,
      opportunityCardsPath: null,
      errorMessage: null,
    }

    const saved = await saveResearchSession(tmp.path, session)

    expect(saved.opportunityCardsPath).toBeTruthy()
    expect(await fileExists(saved.opportunityCardsPath!)).toBe(true)
    const raw = JSON.parse(await readFileRaw(saved.opportunityCardsPath!))
    expect(raw[0]).toMatchObject({ cardId: "card-1", title: "主图测试助理" })
  })
})

describe("chat persistence — round-trip (new format)", () => {
  function makeConv(id: string, title: string = "conv"): Conversation {
    return { id, title, createdAt: 0, updatedAt: 1 }
  }
  function makeMsg(id: string, convId: string, content: string): DisplayMessage {
    return { id, role: "user", content, timestamp: 0, conversationId: convId }
  }

  it("writes conversations.json + per-conversation chats/<id>.json", async () => {
    await saveChatHistory(
      tmp.path,
      [makeConv("c1"), makeConv("c2")],
      [
        makeMsg("m1", "c1", "hello"),
        makeMsg("m2", "c1", "world"),
        makeMsg("m3", "c2", "other"),
      ],
    )
    expect(await fileExists(`${tmp.path}/.llm-wiki/conversations.json`)).toBe(true)
    expect(await fileExists(`${tmp.path}/.llm-wiki/chats/c1.json`)).toBe(true)
    expect(await fileExists(`${tmp.path}/.llm-wiki/chats/c2.json`)).toBe(true)
  })

  it("round-trips conversations + messages", async () => {
    const convs = [makeConv("c1", "Conv 1"), makeConv("c2", "Conv 2")]
    const msgs = [
      makeMsg("m1", "c1", "hi"),
      makeMsg("m2", "c2", "你好"),
    ]
    await saveChatHistory(tmp.path, convs, msgs)
    const loaded = await loadChatHistory(tmp.path)

    expect(loaded.conversations).toEqual(convs)
    // Messages may be returned in a different order (grouped by conv file),
    // so compare as sets.
    expect(loaded.messages).toEqual(expect.arrayContaining(msgs))
    expect(loaded.messages).toHaveLength(2)
  })

  it("recovers orphan chat files when conversations.json is missing", async () => {
    const orphanMessages: DisplayMessage[] = [
      { ...makeMsg("m1", "orphan", "如何提升主图细节？"), timestamp: 100 },
      { ...makeMsg("m2", "orphan", "可以先看图片证据。"), role: "assistant", timestamp: 200 },
    ]
    await writeFileRaw(
      `${tmp.path}/.llm-wiki/chats/orphan.json`,
      JSON.stringify(orphanMessages),
    )

    const loaded = await loadChatHistory(tmp.path)

    expect(loaded.conversations).toHaveLength(1)
    expect(loaded.conversations[0]).toMatchObject({
      id: "orphan",
      title: "如何提升主图细节？",
      createdAt: 100,
      updatedAt: 200,
    })
    expect(loaded.messages).toEqual(orphanMessages)
  })

  it("merges orphan chat files missing from conversations.json", async () => {
    await writeFileRaw(
      `${tmp.path}/.llm-wiki/conversations.json`,
      JSON.stringify([makeConv("indexed", "已索引会话")]),
    )
    const indexedMessages = [makeMsg("m1", "indexed", "已有索引")]
    const orphanMessages = [makeMsg("m2", "orphan", "索引漏掉的历史")]
    await writeFileRaw(
      `${tmp.path}/.llm-wiki/chats/indexed.json`,
      JSON.stringify(indexedMessages),
    )
    await writeFileRaw(
      `${tmp.path}/.llm-wiki/chats/orphan.json`,
      JSON.stringify(orphanMessages),
    )

    const loaded = await loadChatHistory(tmp.path)

    expect(loaded.conversations.map((conv) => conv.id)).toEqual(expect.arrayContaining(["indexed", "orphan"]))
    expect(loaded.messages).toEqual(expect.arrayContaining([...indexedMessages, ...orphanMessages]))
  })

  it("does not persist empty global New Conversation entries", async () => {
    await saveChatHistory(
      tmp.path,
      [
        makeConv("empty", "New Conversation"),
        { ...makeConv("revision", "修订线程"), scope: "revision-workbench", docId: "doc-1" },
      ],
      [],
    )

    const raw = JSON.parse(await readFileRaw(`${tmp.path}/.llm-wiki/conversations.json`)) as Conversation[]

    expect(raw.map((conv) => conv.id)).not.toContain("empty")
    expect(raw.map((conv) => conv.id)).toContain("revision")
  })

  it("preserves revision-aware answer meta through round-trip", async () => {
    const convs = [makeConv("c1", "修订感知问答")]
    const msgs: DisplayMessage[] = [
      {
        id: "m1",
        role: "assistant",
        content: "直接答案\n\n依据\n\n当前依据来自：修订稿",
        timestamp: 1,
        conversationId: "c1",
        references: [
          {
            title: "修订稿片段 1",
            path: "deliverables/revised-docs/doc-1/draft.md",
            kind: "draft",
          },
        ],
        answerMeta: {
          supplements: [
            {
              supplementId: "supp-1",
              title: "启发性补充",
              origin: "model_experience",
              disclaimer: "这条内容目前不属于已确认底稿。",
              candidateSentence: "所有主图优化方案都应先经过小流量验证。",
              rationale: "这样能避免仅凭审美偏好直接改图。",
              targetFieldKey: "validation_methods",
              linkedCardId: "card-1",
              confidence: 0.78,
            },
          ],
        },
      },
    ]

    await saveChatHistory(tmp.path, convs, msgs)
    const loaded = await loadChatHistory(tmp.path)

    expect(loaded.conversations).toEqual(convs)
    expect(loaded.messages).toHaveLength(1)
    expect(loaded.messages[0].answerMeta?.supplements[0]).toMatchObject({
      supplementId: "supp-1",
      origin: "model_experience",
      targetFieldKey: "validation_methods",
      linkedCardId: "card-1",
    })
  })

  it("preserves references, answer meta, and image evidence through round-trip", async () => {
    const convs = [makeConv("c1", "图文问答")]
    const msgs: DisplayMessage[] = [
      {
        id: "m1",
        role: "assistant",
        content: "可以从细节图、卖点放大和对比信息入手。",
        timestamp: 1,
        conversationId: "c1",
        references: [
          { title: "主图设计", path: "wiki/sources/主图设计.md", kind: "source" },
        ],
        answerMeta: {
          supplements: [
            {
              supplementId: "supp-1",
              title: "可复用检查点",
              origin: "evidence_extension",
              disclaimer: "这条内容目前不属于已确认底稿。",
              candidateSentence: "主图细节应优先服务首屏卖点识别。",
              rationale: "图片证据显示细节放大能帮助第一眼识别。",
              confidence: 0.7,
            },
          ],
        },
        imageEvidence: [
          {
            imageId: "image-1",
            displayId: "img-1",
            relPath: "media/主图设计/img-1.png",
            caption: "主图细节图案例",
            fallbackCaption: "主图设计 第 1 页图片 1",
            sourcePath: "wiki/sources/主图设计.md",
            page: 1,
            matchedReason: "图片说明命中：细节图",
            status: "captioned",
            score: 42,
          },
        ],
      },
    ]

    await saveChatHistory(tmp.path, convs, msgs)
    const loaded = await loadChatHistory(tmp.path)

    expect(loaded.messages).toHaveLength(1)
    expect(loaded.messages[0].references?.[0]).toMatchObject({ path: "wiki/sources/主图设计.md" })
    expect(loaded.messages[0].answerMeta?.supplements[0]?.candidateSentence).toContain("主图细节")
    expect(loaded.messages[0].imageEvidence?.[0]).toMatchObject({
      imageId: "image-1",
      relPath: "media/主图设计/img-1.png",
      status: "captioned",
    })
  })

  it("caps each conversation's persisted messages at 100 (oldest dropped)", async () => {
    const convs = [makeConv("c1")]
    const msgs = Array.from({ length: 150 }, (_, i) =>
      makeMsg(`m${i}`, "c1", `msg ${i}`),
    )
    await saveChatHistory(tmp.path, convs, msgs)
    const loaded = await loadChatHistory(tmp.path)
    expect(loaded.messages).toHaveLength(100)
    // Should have kept the LAST 100 (m50 .. m149)
    expect(loaded.messages[0].id).toBe("m50")
    expect(loaded.messages[99].id).toBe("m149")
  })

  it("returns empty data when no persistence file exists", async () => {
    const loaded = await loadChatHistory(tmp.path)
    expect(loaded).toEqual({ conversations: [], messages: [] })
  })

  it("skips missing per-conversation files without throwing", async () => {
    // conversations.json references c1 + c2, but chats/c2.json is missing
    await writeFileRaw(
      `${tmp.path}/.llm-wiki/conversations.json`,
      JSON.stringify([makeConv("c1"), makeConv("c2")]),
    )
    await writeFileRaw(
      `${tmp.path}/.llm-wiki/chats/c1.json`,
      JSON.stringify([makeMsg("m1", "c1", "hi")]),
    )
    const loaded = await loadChatHistory(tmp.path)
    expect(loaded.conversations).toHaveLength(2)
    expect(loaded.messages).toHaveLength(1)
  })

  it("preserves Unicode content through round-trip", async () => {
    const convs = [makeConv("c1", "中文对话 🎌")]
    const msgs = [
      makeMsg("m1", "c1", "你好，世界 🌍"),
      makeMsg("m2", "c1", "これはテスト"),
    ]
    await saveChatHistory(tmp.path, convs, msgs)
    const loaded = await loadChatHistory(tmp.path)
    expect(loaded.conversations[0].title).toBe("中文对话 🎌")
    expect(loaded.messages[0].content).toBe("你好，世界 🌍")
  })
})

describe("chat persistence — legacy format fallback", () => {
  function makeConv(id: string): Conversation {
    return { id, title: "t", createdAt: 0, updatedAt: 1 }
  }
  function makeMsg(id: string, convId: string): DisplayMessage {
    return { id, role: "user", content: "c", timestamp: 0, conversationId: convId }
  }

  it("falls back to chat-history.json flat-array format", async () => {
    // Very old format: flat array of messages
    const legacyMessages = [
      { id: "m1", role: "user", content: "old", timestamp: 100, conversationId: "ignored" },
      { id: "m2", role: "assistant", content: "older", timestamp: 200, conversationId: "ignored" },
    ]
    await writeFileRaw(
      `${tmp.path}/.llm-wiki/chat-history.json`,
      JSON.stringify(legacyMessages),
    )

    const loaded = await loadChatHistory(tmp.path)
    expect(loaded.conversations).toHaveLength(1)
    expect(loaded.conversations[0].id).toBe("default")
    expect(loaded.messages).toHaveLength(2)
    expect(loaded.messages[0].conversationId).toBe("default")
  })

  it("falls back to chat-history.json combined-object format", async () => {
    const old = {
      conversations: [makeConv("c1")],
      messages: [makeMsg("m1", "c1")],
    }
    await writeFileRaw(
      `${tmp.path}/.llm-wiki/chat-history.json`,
      JSON.stringify(old),
    )

    const loaded = await loadChatHistory(tmp.path)
    expect(loaded.conversations).toHaveLength(1)
    expect(loaded.messages).toHaveLength(1)
  })

  it("new format wins over legacy when both exist", async () => {
    await writeFileRaw(
      `${tmp.path}/.llm-wiki/chat-history.json`,
      JSON.stringify({ conversations: [makeConv("legacy")], messages: [] }),
    )
    await writeFileRaw(
      `${tmp.path}/.llm-wiki/conversations.json`,
      JSON.stringify([makeConv("new")]),
    )
    await writeFileRaw(`${tmp.path}/.llm-wiki/chats/new.json`, "[]")

    const loaded = await loadChatHistory(tmp.path)
    expect(loaded.conversations[0].id).toBe("new")
  })
})

// Keep readFileRaw exported (referenced for a future direct-inspection test)
void readFileRaw
