import { defineStore } from "pinia";
import type { MethodProfileEntity } from "@/entities/method-profile/types";
import { methodProfileMock, persistentMemoryMock, profileProposalsMock } from "@/mocks/profile.mock";

export const useProfileStore = defineStore("profile", {
  state: (): {
    methodProfile: MethodProfileEntity;
    persistentMemory: Record<string, unknown>;
    proposals: Record<string, any>;
    loading: boolean;
  } => ({
    methodProfile: methodProfileMock,
    persistentMemory: persistentMemoryMock,
    proposals: profileProposalsMock,
    loading: false,
  }),
});
