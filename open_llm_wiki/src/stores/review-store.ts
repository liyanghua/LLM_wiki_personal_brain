import { create } from "zustand"
import { normalizeReviewTitle } from "@/lib/review-utils"
import type { IssueScope, RootCause } from "@/lib/quality-contracts"

export interface ReviewOption {
  label: string
  action: string // identifier for the action
}

export interface ReviewItem {
  id: string
  type: "contradiction" | "duplicate" | "missing-page" | "confirm" | "suggestion"
  title: string
  description: string
  sourcePath?: string
  affectedPages?: string[]
  searchQueries?: string[]
  options: ReviewOption[]
  origin?: "agent_mode" | "wiki_lint"
  issueScope?: IssueScope
  rootCause?: RootCause | null
  linkedIssueId?: string | null
  linkedDocId?: string | null
  researchSessionId?: string | null
  researchFindingId?: string | null
  researchEvidenceSummary?: string | null
  researchSourceUrls?: string[]
  targetFieldKey?: string | null
  resolved: boolean
  resolvedAction?: string
  createdAt: number
}

interface ReviewState {
  items: ReviewItem[]
  addItem: (item: Omit<ReviewItem, "id" | "resolved" | "createdAt">) => void
  addItems: (items: Omit<ReviewItem, "id" | "resolved" | "createdAt">[]) => void
  setItems: (items: ReviewItem[]) => void
  resolveItem: (id: string, action: string) => void
  dismissItem: (id: string) => void
  clearResolved: () => void
}

let counter = 0

function normalizeReviewItem(item: ReviewItem): ReviewItem {
  const issueScope = item.issueScope ?? "wiki_asset"
  return {
    ...item,
    origin: item.origin ?? (issueScope === "source_document" ? "agent_mode" : "wiki_lint"),
    issueScope,
    rootCause: item.rootCause ?? null,
    linkedIssueId: item.linkedIssueId ?? null,
    linkedDocId: item.linkedDocId ?? null,
    researchSessionId: item.researchSessionId ?? null,
    researchFindingId: item.researchFindingId ?? null,
    researchEvidenceSummary: item.researchEvidenceSummary ?? null,
    researchSourceUrls: item.researchSourceUrls ?? [],
    targetFieldKey: item.targetFieldKey ?? null,
  }
}

export const useReviewStore = create<ReviewState>((set) => ({
  items: [],

  addItem: (item) =>
    set((state) => ({
      items: [
        ...state.items,
        normalizeReviewItem({
          ...item,
          id: `review-${++counter}`,
          resolved: false,
          createdAt: Date.now(),
        }),
      ],
    })),

  addItems: (items) =>
    set((state) => {
      // De-dupe against pending items with same type + normalized title (all
      // 5 types — bulk ingest can re-surface the same contradiction/confirm
      // from multiple files).
      // Merge affectedPages / searchQueries / sourcePath instead of duplicating.
      const result = [...state.items]
      const keyFor = (t: string, title: string) => `${t}::${normalizeReviewTitle(title)}`

      // Build index of existing pending items for fast lookup
      const pendingIndex = new Map<string, number>()
      result.forEach((it, idx) => {
        if (!it.resolved) {
          pendingIndex.set(keyFor(it.type, it.title), idx)
        }
      })

      for (const incoming of items) {
        const k = keyFor(incoming.type, incoming.title)
        const existingIdx = pendingIndex.get(k)

        if (existingIdx !== undefined) {
          // Merge into existing
          const old = result[existingIdx]
          const mergedPages = Array.from(new Set([...(old.affectedPages ?? []), ...(incoming.affectedPages ?? [])]))
          const mergedQueries = Array.from(new Set([...(old.searchQueries ?? []), ...(incoming.searchQueries ?? [])]))
          result[existingIdx] = normalizeReviewItem({
            ...old,
            description: incoming.description || old.description, // prefer newer description
            sourcePath: incoming.sourcePath ?? old.sourcePath,
            affectedPages: mergedPages.length > 0 ? mergedPages : undefined,
            searchQueries: mergedQueries.length > 0 ? mergedQueries : undefined,
            origin: incoming.origin ?? old.origin,
            issueScope: incoming.issueScope ?? old.issueScope,
            rootCause: incoming.rootCause ?? old.rootCause,
            linkedIssueId: incoming.linkedIssueId ?? old.linkedIssueId,
            linkedDocId: incoming.linkedDocId ?? old.linkedDocId,
            researchSessionId: incoming.researchSessionId ?? old.researchSessionId,
            researchFindingId: incoming.researchFindingId ?? old.researchFindingId,
            researchEvidenceSummary: incoming.researchEvidenceSummary ?? old.researchEvidenceSummary,
            researchSourceUrls: Array.from(new Set([...(old.researchSourceUrls ?? []), ...(incoming.researchSourceUrls ?? [])])),
            targetFieldKey: incoming.targetFieldKey ?? old.targetFieldKey,
          })
        } else {
          const newItem = normalizeReviewItem({
            ...incoming,
            id: `review-${++counter}`,
            resolved: false,
            createdAt: Date.now(),
          })
          result.push(newItem)
          pendingIndex.set(k, result.length - 1)
        }
      }

      return { items: result }
    }),

  setItems: (items) => set({ items: items.map(normalizeReviewItem) }),

  resolveItem: (id, action) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id ? { ...item, resolved: true, resolvedAction: action } : item
      ),
    })),

  dismissItem: (id) =>
    set((state) => ({
      items: state.items.filter((item) => item.id !== id),
    })),

  clearResolved: () =>
    set((state) => ({
      items: state.items.filter((item) => !item.resolved),
    })),
}))
