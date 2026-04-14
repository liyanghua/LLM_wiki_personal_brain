import { defineStore } from "pinia";
import type { EvalReportEntity, EvalReportSummaryEntity } from "@/entities/eval-report/types";
import { evalReportDetailMock, evalReportsMock } from "@/mocks/eval.mock";

export const useEvalStore = defineStore("eval", {
  state: (): {
    reports: EvalReportSummaryEntity[];
    selectedReportId: string;
    detail: EvalReportEntity;
    loading: boolean;
  } => ({
    reports: evalReportsMock.reports,
    selectedReportId: evalReportDetailMock.run_id,
    detail: evalReportDetailMock,
    loading: false,
  }),
});
