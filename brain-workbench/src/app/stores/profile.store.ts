import { defineStore } from "pinia";
import type { MethodProfileEntity } from "@/entities/method-profile/types";

const emptyProfile: MethodProfileEntity = {
  method_profile_id: "",
  preferred_answer_structure: [],
  abstraction_depth: "",
  operationalization_level: "",
  explanation_pattern: "",
  reusable_asset_preferences: [],
  citation_preference: "",
  assetization_preference: "",
  favored_output_forms: [],
  preferred_tone: "",
  actionability_preference: "",
};

export const useProfileStore = defineStore("profile", {
  state: (): {
    methodProfile: MethodProfileEntity;
    persistentMemory: Record<string, unknown>;
    proposals: Record<string, any>;
    loading: boolean;
    error: string;
  } => ({
    methodProfile: emptyProfile,
    persistentMemory: {},
    proposals: { method_suggestions: [], style_suggestions: [], persistent_memory_proposals: [] },
    loading: false,
    error: "",
  }),
});
