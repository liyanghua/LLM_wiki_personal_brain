import { evalReportDetailMock, evalReportsMock } from "@/mocks/eval.mock";
import { apiClient } from "@/shared/api/client";
import { ENDPOINTS } from "@/shared/api/endpoints";
import { mapEvalReportDetail, mapEvalReports } from "./mapper";

export async function listEvalReports() {
  const payload = await apiClient.get(ENDPOINTS.evalReports, () => evalReportsMock);
  return mapEvalReports(payload);
}

export async function getEvalReport(runId: string) {
  const payload = await apiClient.get(ENDPOINTS.evalReport(runId), () => evalReportDetailMock);
  return mapEvalReportDetail(payload);
}
