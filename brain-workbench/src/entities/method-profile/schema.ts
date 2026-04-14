import { z } from "zod";

export const methodProfileSchema = z.object({
  method_profile_id: z.string(),
  preferred_answer_structure: z.array(z.string()),
  abstraction_depth: z.string(),
  operationalization_level: z.string(),
  explanation_pattern: z.string(),
  reusable_asset_preferences: z.array(z.string()),
  citation_preference: z.string(),
  assetization_preference: z.string(),
  favored_output_forms: z.array(z.string()),
  preferred_tone: z.string(),
  actionability_preference: z.string(),
});
