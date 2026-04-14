import { toEvalReportEntity, toEvalReportSummaryEntity } from "@/entities/eval-report/adapters";

export function mapEvalReports(payload: { reports: unknown[] }) {
  return payload.reports.map(toEvalReportSummaryEntity);
}

export function mapEvalReportDetail(payload: unknown) {
  return toEvalReportEntity(payload);
}
