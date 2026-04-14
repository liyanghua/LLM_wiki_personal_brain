import { apiClient } from "@/shared/api/client";
import { ENDPOINTS } from "@/shared/api/endpoints";
import { mapOntologyCandidates } from "./mapper";

export async function listOntologyCandidates() {
  const payload = await apiClient.get<{ candidates: unknown[] }>(ENDPOINTS.ontologyCandidates);
  return mapOntologyCandidates(payload);
}
