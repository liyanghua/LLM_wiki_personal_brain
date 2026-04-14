import { toWritebackBundleEntity } from "@/entities/writeback-proposal/adapters";
import { writebackDetailMock, writebackListMock } from "@/mocks/writeback.mock";
import { apiClient } from "@/shared/api/client";
import { ENDPOINTS } from "@/shared/api/endpoints";

export async function listWritebackProposals() {
  return await apiClient.get(ENDPOINTS.writebackList, () => writebackListMock);
}

export async function getWritebackProposal(queryId: string) {
  const payload = await apiClient.get(ENDPOINTS.writebackDetail(queryId), () => writebackDetailMock);
  return toWritebackBundleEntity(payload);
}

export async function approveWritebackProposal(queryId: string) {
  const payload = await apiClient.post(ENDPOINTS.writebackApply(queryId), {}, () => writebackDetailMock);
  return toWritebackBundleEntity(payload);
}
