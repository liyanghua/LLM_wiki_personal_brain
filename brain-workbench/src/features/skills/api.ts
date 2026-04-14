import { apiClient } from "@/shared/api/client";
import { ENDPOINTS } from "@/shared/api/endpoints";
import { mapSkillCandidates } from "./mapper";

export async function listSkillCandidates() {
  const payload = await apiClient.get<{ candidates: unknown[] }>(ENDPOINTS.skillCandidates);
  return mapSkillCandidates(payload);
}
