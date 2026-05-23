import { writeFile, readFile, createDirectory, listDirectory } from "@/commands/fs"
import type { ReviewItem } from "@/stores/review-store"
import type { DisplayMessage, Conversation, ConversationScope } from "@/stores/chat-store"
import { normalizePath } from "@/lib/path-utils"
import type { AgentModeReport, InteractiveSession, RevisionDraft, RevisionVersion } from "@/lib/agent-mode-types"

async function ensureDir(projectPath: string): Promise<void> {
  await createDirectory(`${projectPath}/.llm-wiki`).catch(() => {})
  await createDirectory(`${projectPath}/.llm-wiki/chats`).catch(() => {})
  await createDirectory(`${projectPath}/.llm-wiki/agent-mode`).catch(() => {})
  await createDirectory(`${projectPath}/.llm-wiki/interactive-sessions`).catch(() => {})
  await createDirectory(`${projectPath}/.llm-wiki/revisions`).catch(() => {})
}

export async function saveReviewItems(projectPath: string, items: ReviewItem[]): Promise<void> {
  const pp = normalizePath(projectPath)
  await ensureDir(pp)
  await writeFile(`${pp}/.llm-wiki/review.json`, JSON.stringify(items, null, 2))
}

export async function loadReviewItems(projectPath: string): Promise<ReviewItem[]> {
  const pp = normalizePath(projectPath)
  try {
    const content = await readFile(`${pp}/.llm-wiki/review.json`)
    return JSON.parse(content) as ReviewItem[]
  } catch {
    return []
  }
}

interface PersistedChatData {
  conversations: Conversation[]
  messages: DisplayMessage[]
}

function conversationMessageCounts(messages: DisplayMessage[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const message of messages) {
    counts.set(message.conversationId, (counts.get(message.conversationId) ?? 0) + 1)
  }
  return counts
}

function shouldPersistConversation(conversation: Conversation, messageCount: number): boolean {
  if (messageCount > 0) return true
  return (conversation.scope ?? "global") !== "global"
}

function shouldKeepLoadedConversation(conversation: Conversation, messageCount: number): boolean {
  if (messageCount > 0) return true
  if ((conversation.scope ?? "global") !== "global") return true
  return conversation.title.trim() !== "New Conversation"
}

function normalizeLoadedMessages(conversationId: string, messages: DisplayMessage[]): DisplayMessage[] {
  return messages.map((message) => ({
    ...message,
    conversationId,
  }))
}

async function listChatFiles(projectPath: string): Promise<{ id: string; path: string }[]> {
  try {
    const nodes = await listDirectory(`${projectPath}/.llm-wiki/chats`)
    return nodes
      .filter((node) => !node.is_dir && node.name.endsWith(".json"))
      .map((node) => ({
        id: node.name.replace(/\.json$/, ""),
        path: node.path,
      }))
  } catch {
    return []
  }
}

async function readChatFile(filePath: string, conversationId: string): Promise<DisplayMessage[]> {
  try {
    const content = await readFile(filePath)
    const parsed = JSON.parse(content)
    if (!Array.isArray(parsed)) return []
    return normalizeLoadedMessages(conversationId, parsed as DisplayMessage[])
  } catch {
    return []
  }
}

function inferRecoveredConversationScope(messages: DisplayMessage[]): Pick<Conversation, "scope" | "docId" | "loopId"> {
  const revisionMessage = messages.find((message) => message.revisionMeta?.docId)
  const revisionMeta = revisionMessage?.revisionMeta
  if (!revisionMeta?.docId) return {}
  const scope: ConversationScope = revisionMeta.loopId ? "revision-loop" : "revision-workbench"
  return {
    scope,
    docId: revisionMeta.docId,
    loopId: revisionMeta.loopId ?? null,
  }
}

function recoverConversationFromMessages(conversationId: string, messages: DisplayMessage[]): Conversation | null {
  if (messages.length === 0) return null
  const firstUserMessage = messages.find((message) => message.role === "user")
  const timestamps = messages
    .map((message) => message.timestamp)
    .filter((timestamp): timestamp is number => typeof timestamp === "number")
  const now = Date.now()
  const createdAt = timestamps.length > 0 ? Math.min(...timestamps) : now
  const updatedAt = timestamps.length > 0 ? Math.max(...timestamps) : now
  const title = firstUserMessage?.content?.trim().slice(0, 50) || "历史会话"

  return {
    id: conversationId,
    title,
    createdAt,
    updatedAt,
    ...inferRecoveredConversationScope(messages),
  }
}

export async function saveChatHistory(
  projectPath: string,
  conversations: Conversation[],
  messages: DisplayMessage[]
): Promise<void> {
  const pp = normalizePath(projectPath)
  await ensureDir(pp)

  const messageCounts = conversationMessageCounts(messages)
  const conversationsToSave = conversations.filter((conversation) =>
    shouldPersistConversation(conversation, messageCounts.get(conversation.id) ?? 0)
  )

  // Save conversation list
  await writeFile(
    `${pp}/.llm-wiki/conversations.json`,
    JSON.stringify(conversationsToSave, null, 2)
  )

  // Save each conversation's messages separately
  const byConversation = new Map<string, DisplayMessage[]>()
  for (const msg of messages) {
    const list = byConversation.get(msg.conversationId) ?? []
    list.push(msg)
    byConversation.set(msg.conversationId, list)
  }

  for (const [convId, msgs] of byConversation) {
    // Keep last 100 messages per conversation
    const toSave = msgs.slice(-100)
    await writeFile(
      `${pp}/.llm-wiki/chats/${convId}.json`,
      JSON.stringify(toSave, null, 2)
    )
  }
}

export async function loadChatHistory(projectPath: string): Promise<PersistedChatData> {
  const pp = normalizePath(projectPath)
  const conversationsById = new Map<string, Conversation>()
  const messagesByConversation = new Map<string, DisplayMessage[]>()
  let foundNewFormat = false

  // Try new format: separate files per conversation.
  try {
    const convContent = await readFile(`${pp}/.llm-wiki/conversations.json`)
    const conversations = JSON.parse(convContent) as Conversation[]
    if (Array.isArray(conversations)) {
      foundNewFormat = true
      for (const conversation of conversations) {
        conversationsById.set(conversation.id, conversation)
        const messages = await readChatFile(`${pp}/.llm-wiki/chats/${conversation.id}.json`, conversation.id)
        if (messages.length > 0) {
          messagesByConversation.set(conversation.id, messages)
        }
      }
    }
  } catch {
    // conversations.json is optional; chat files can still recover history.
  }

  const chatFiles = await listChatFiles(pp)
  if (chatFiles.length > 0) foundNewFormat = true
  for (const file of chatFiles) {
    if (messagesByConversation.has(file.id)) continue
    const messages = await readChatFile(file.path, file.id)
    if (messages.length === 0) continue
    messagesByConversation.set(file.id, messages)
    if (!conversationsById.has(file.id)) {
      const recovered = recoverConversationFromMessages(file.id, messages)
      if (recovered) {
        conversationsById.set(file.id, recovered)
      }
    }
  }

  if (foundNewFormat) {
    const allMessages = Array.from(messagesByConversation.values()).flat()
    const messageCounts = conversationMessageCounts(allMessages)
    const conversations = Array.from(conversationsById.values())
      .filter((conversation) => shouldKeepLoadedConversation(conversation, messageCounts.get(conversation.id) ?? 0))
    const keptConversationIds = new Set(conversations.map((conversation) => conversation.id))
    return {
      conversations,
      messages: allMessages.filter((message) => keptConversationIds.has(message.conversationId)),
    }
  }

  // Fall back to old format
  try {
    const content = await readFile(`${pp}/.llm-wiki/chat-history.json`)
    const parsed = JSON.parse(content)

    if (Array.isArray(parsed)) {
      // Very old format: flat array
      const legacyMessages = parsed as DisplayMessage[]
      const defaultConv: Conversation = {
        id: "default",
        title: "Previous Conversations",
        createdAt: legacyMessages[0]?.timestamp ?? Date.now(),
        updatedAt: legacyMessages[legacyMessages.length - 1]?.timestamp ?? Date.now(),
      }
      const migratedMessages = legacyMessages.map((m) => ({
        ...m,
        conversationId: "default",
      }))
      return { conversations: [defaultConv], messages: migratedMessages }
    }

    // Old combined format
    const data = parsed as PersistedChatData
    return data
  } catch {
    return { conversations: [], messages: [] }
  }
}

export interface PersistedAgentModeData {
  reports: AgentModeReport[]
  sessions: InteractiveSession[]
  drafts: RevisionDraft[]
  versions: RevisionVersion[]
}
