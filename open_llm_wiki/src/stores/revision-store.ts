import { create } from "zustand"
import type { RevisionDraft, RevisionVersion } from "@/lib/agent-mode-types"

interface RevisionState {
  drafts: RevisionDraft[]
  versions: RevisionVersion[]
  setDrafts: (drafts: RevisionDraft[]) => void
  upsertDraft: (draft: RevisionDraft) => void
  setVersions: (versions: RevisionVersion[]) => void
  upsertVersion: (version: RevisionVersion) => void
  getDraftByDocId: (docId: string) => RevisionDraft | null
  reset: () => void
}

export const useRevisionStore = create<RevisionState>((set, get) => ({
  drafts: [],
  versions: [],
  setDrafts: (drafts) => set({ drafts }),
  upsertDraft: (draft) =>
    set((state) => ({
      drafts: [draft, ...state.drafts.filter((item) => item.docId !== draft.docId)],
    })),
  setVersions: (versions) => set({ versions }),
  upsertVersion: (version) =>
    set((state) => ({
      versions: [version, ...state.versions.filter((item) => item.versionId !== version.versionId)],
    })),
  getDraftByDocId: (docId) => get().drafts.find((draft) => draft.docId === docId) ?? null,
  reset: () => set({ drafts: [], versions: [] }),
}))
