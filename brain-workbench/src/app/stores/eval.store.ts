import { defineStore } from "pinia";
import type { EvalReportEntity, EvalReportSummaryEntity } from "@/entities/eval-report/types";

const emptyDetail: EvalReportEntity = {
  run_id: "",
  created_at: "",
  metrics: {},
  case_results: [],
};

export const useEvalStore = defineStore("eval", {
  state: (): {
    reports: EvalReportSummaryEntity[];
    selectedReportId: string;
    detail: EvalReportEntity;
    loading: boolean;
    error: string;
  } => ({
    reports: [],
    selectedReportId: "",
    detail: emptyDetail,
    loading: false,
    error: "",
  }),
});
