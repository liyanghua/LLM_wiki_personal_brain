import type { SkillCandidateEntity } from "./types";
import { skillCandidateSchema } from "./schema";

export function toSkillCandidateEntity(payload: unknown): SkillCandidateEntity {
  return skillCandidateSchema.parse(payload);
}
