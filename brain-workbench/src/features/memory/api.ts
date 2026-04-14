import { memoryRecentMock } from "@/mocks/memory.mock";
import { apiClient } from "@/shared/api/client";
import { ENDPOINTS } from "@/shared/api/endpoints";
import { mapRecentMemory } from "./mapper";

export async function loadRecentMemory() {
  const payload = await apiClient.get(ENDPOINTS.memoryRecent, () => memoryRecentMock);
  return mapRecentMemory(payload);
}
