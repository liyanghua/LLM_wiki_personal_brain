import { toAskResultEntity } from "@/entities/answer-record/adapters";
import { queryResponseMock } from "@/mocks/query.mock";
import { apiClient } from "@/shared/api/client";
import { ENDPOINTS } from "@/shared/api/endpoints";

export async function askQuestion(question: string) {
  const payload = await apiClient.post(ENDPOINTS.ask, { question }, () => queryResponseMock);
  return toAskResultEntity(payload);
}
