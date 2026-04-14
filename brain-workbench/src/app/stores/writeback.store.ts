import { defineStore } from "pinia";
import type { WritebackBundleEntity } from "@/entities/writeback-proposal/types";
import { writebackDetailMock, writebackListMock } from "@/mocks/writeback.mock";

export const useWritebackStore = defineStore("writeback", {
  state: (): {
    proposals: Array<Record<string, unknown>>;
    selectedQueryId: string;
    detail: WritebackBundleEntity;
    loading: boolean;
  } => ({
    proposals: writebackListMock.proposals,
    selectedQueryId: writebackDetailMock.query_id,
    detail: writebackDetailMock,
    loading: false,
  }),
});
