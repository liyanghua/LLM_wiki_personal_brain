import { defineStore } from "pinia";
import type { WritebackBundleEntity } from "@/entities/writeback-proposal/types";

const emptyDetail: WritebackBundleEntity = {
  query_id: "",
  question: "",
  created_at: "",
  target_paths: [],
  applied_targets: [],
  targets: [],
};

export const useWritebackStore = defineStore("writeback", {
  state: (): {
    proposals: Array<Record<string, unknown>>;
    selectedQueryId: string;
    detail: WritebackBundleEntity;
    loading: boolean;
    error: string;
  } => ({
    proposals: [],
    selectedQueryId: "",
    detail: emptyDetail,
    loading: false,
    error: "",
  }),
});
