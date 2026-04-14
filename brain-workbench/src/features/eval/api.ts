import { apiClient } from "@/shared/api/client";
import { ENDPOINTS } from "@/shared/api/endpoints";
import { mapEvalReportDetail, mapEvalReports } from "./mapper";

export async function listEvalReports() {
  const payload = await apiClient.get<{ reports: unknown[] }>(ENDPOINTS.evalReports);
  return mapEvalReports(payload);
}

export async function getEvalReport(runId: string) {
  const payload = await apiClient.get(ENDPOINTS.evalReport(runId));
  return mapEvalReportDetail(payload);
}
