import type { EvalReportEntity, EvalReportSummaryEntity } from "./types";
import { evalReportSchema, evalReportSummarySchema } from "./schema";

export function toEvalReportSummaryEntity(payload: unknown): EvalReportSummaryEntity {
  return evalReportSummarySchema.parse(payload);
}

export function toEvalReportEntity(payload: unknown): EvalReportEntity {
  return evalReportSchema.parse(payload);
}
