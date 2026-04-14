import { apiClient } from "@/shared/api/client";
import { ENDPOINTS } from "@/shared/api/endpoints";
import { mapMethodProfile } from "./mapper";

export async function getMethodProfile() {
  const payload = await apiClient.get(ENDPOINTS.profileMethod);
  return mapMethodProfile(payload);
}

export async function getPersistentMemory() {
  return await apiClient.get(ENDPOINTS.profileMemory);
}

export async function getProfileProposals() {
  return await apiClient.get(ENDPOINTS.profileProposals);
}
