import { beforeEach, describe, expect, it } from "vitest"
import {
  conversationMatchesScope,
  shouldShowConversationInSidebar,
  useChatStore,
  type ChatImageEvidence,
  type ChatTaskEvidence,
} from "@/stores/chat-store"

const sampleImageEvidence: ChatImageEvidence[] = [
  {
    imageId: "image-0001",
    displayId: "img-1",
    relPath: "media/主图设计/img-1.png",
    caption: "主图设计 第 1 页图片 1，缺少视觉说明",
    fallbackCaption: "主图设计 第 1 页图片 1，缺少视觉说明",
    sourcePath: "wiki/sources/主图设计.md",
    page: 1,
    matchedReason: "按来源主题召回，待补图片说明：命中 主图、设计",
    status: "needs_caption",
    score: 32,
  },
]

const sampleTaskEvidence: ChatTaskEvidence[] = [
  {
    taskId: "task-ready",
    title: "优化主图点击率",
    taskModule: "visual_content",
    taskModuleLabel: "商品视觉与内容创作",
    productId: "741405253807",
    taskItem: "优化主图细节图",
    taskStatus: "in_progress",
    resultFeedback: [],
    ownerRole: "运营负责人",
    collaboratorRoles: ["美工"],
    timeRangeLabel: "2026-05",
    cadence: "weekly",
    priority: "high",
    qualityScore: 94,
    executableScore: 92,
    importanceScore: 88,
    status: "draft",
    qualityBand: "ready",
    matchedReasons: ["角色匹配：运营负责人"],
    missingElements: [],
    sourceRefs: ["raw/week.xlsx#sheet=周会"],
    wikiRefs: ["wiki/tasks/week.md"],
  },
]

describe("chat store image evidence", () => {
  beforeEach(() => {
    useChatStore.setState({
      conversations: [],
      activeConversationId: null,
      messages: [],
      isStreaming: false,
      streamingContent: "",
      streamingImageEvidence: [],
      streamingTaskEvidence: [],
      mode: "chat",
      ingestSource: null,
      maxHistoryMessages: 10,
    })
  })

  it("keeps image evidence visible while streaming", () => {
    useChatStore.getState().setStreamingImageEvidence(sampleImageEvidence)

    expect(useChatStore.getState().streamingImageEvidence).toEqual(sampleImageEvidence)
  })

  it("persists image evidence onto the finalized assistant message", () => {
    const conversationId = useChatStore.getState().createConversation()
    useChatStore.getState().addMessage("user", "如何提升主图设计的细节？", { conversationId })
    useChatStore.getState().setStreaming(true)
    useChatStore.getState().setStreamingImageEvidence(sampleImageEvidence)

    useChatStore.getState().finalizeStream("可以从细节图、卖点放大和对比信息入手。", [], null, sampleImageEvidence)

    const assistant = useChatStore.getState().messages.find((message) => message.role === "assistant")
    expect(assistant?.imageEvidence).toEqual(sampleImageEvidence)
    expect(useChatStore.getState().streamingImageEvidence).toEqual([])
  })

  it("keeps original image index ids so captions can be backfilled later", () => {
    const conversationId = useChatStore.getState().createConversation()
    useChatStore.getState().addMessage("assistant", "图片证据如下。", {
      conversationId,
      imageEvidence: sampleImageEvidence,
    })

    const assistant = useChatStore.getState().messages.find((message) => message.role === "assistant")
    expect(assistant?.imageEvidence?.[0]?.imageId).toBe("image-0001")
    expect(assistant?.imageEvidence?.[0]?.displayId).toBe("img-1")
  })
})

describe("chat store task evidence", () => {
  beforeEach(() => {
    useChatStore.setState({
      conversations: [],
      activeConversationId: null,
      messages: [],
      isStreaming: false,
      streamingContent: "",
      streamingImageEvidence: [],
      streamingTaskEvidence: [],
      mode: "chat",
      ingestSource: null,
      maxHistoryMessages: 10,
    })
  })

  it("persists task evidence onto the finalized assistant message", () => {
    const conversationId = useChatStore.getState().createConversation()
    useChatStore.getState().addMessage("user", "运营负责人 5月任务列表", { conversationId })
    useChatStore.getState().setStreaming(true)
    useChatStore.getState().setStreamingTaskEvidence(sampleTaskEvidence)

    useChatStore.getState().finalizeStream("已按质量分排序。", [], null, [], sampleTaskEvidence)

    const assistant = useChatStore.getState().messages.find((message) => message.role === "assistant")
    expect(assistant?.taskEvidence).toEqual(sampleTaskEvidence)
    expect(useChatStore.getState().streamingTaskEvidence).toEqual([])
  })
})

describe("chat conversation visibility helpers", () => {
  it("hides empty global conversations from the history sidebar", () => {
    expect(shouldShowConversationInSidebar({
      id: "c1",
      title: "New Conversation",
      createdAt: 0,
      updatedAt: 0,
    }, 0)).toBe(false)
  })

  it("keeps scoped revision conversations visible even before they have messages", () => {
    expect(shouldShowConversationInSidebar({
      id: "c1",
      title: "修订后知识验证",
      createdAt: 0,
      updatedAt: 0,
      scope: "revision-workbench",
      docId: "doc-1",
    }, 0)).toBe(true)
  })

  it("matches only the requested conversation scope", () => {
    expect(conversationMatchesScope({
      id: "global",
      title: "普通问答",
      createdAt: 0,
      updatedAt: 0,
    }, "global")).toBe(true)
    expect(conversationMatchesScope({
      id: "revision",
      title: "修订线程",
      createdAt: 0,
      updatedAt: 0,
      scope: "revision-loop",
      docId: "doc-1",
      loopId: "loop-1",
    }, "global")).toBe(false)
  })
})
