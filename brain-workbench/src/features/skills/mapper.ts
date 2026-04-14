import { toSkillCandidateEntity } from "@/entities/skill-candidate/adapters";

export function mapSkillCandidates(payload: { candidates: unknown[] }) {
  return payload.candidates.map(toSkillCandidateEntity);
}
