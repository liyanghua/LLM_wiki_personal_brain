import { skillCandidatesMock } from "@/mocks/assets.mock";
import { apiClient } from "@/shared/api/client";
import { ENDPOINTS } from "@/shared/api/endpoints";
import { mapSkillCandidates } from "./mapper";

export async function listSkillCandidates() {
  const payload = await apiClient.get(ENDPOINTS.skillCandidates, () => skillCandidatesMock);
  return mapSkillCandidates(payload);
}
