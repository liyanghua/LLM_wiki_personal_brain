import { defineStore } from "pinia";
import type { AskResultEntity } from "@/entities/answer-record/types";
import type { MemoryRecentEntity } from "@/entities/memory-item/types";
import { queryResponseMock } from "@/mocks/query.mock";
import { memoryRecentMock } from "@/mocks/memory.mock";

export const useQueryStore = defineStore("query", {
  state: (): {
    currentQuestion: string;
    result: AskResultEntity;
    recentMemory: MemoryRecentEntity;
    loading: boolean;
  } => ({
    currentQuestion: queryResponseMock.user_query,
    result: queryResponseMock,
    recentMemory: memoryRecentMock,
    loading: false,
  }),
});
