import { defineStore } from "pinia";
import type { OntologyCandidateEntity } from "@/entities/ontology-candidate/types";
import type { SkillCandidateEntity } from "@/entities/skill-candidate/types";
import { ontologyCandidatesMock, skillCandidatesMock } from "@/mocks/assets.mock";

export const useAssetsStore = defineStore("assets", {
  state: (): {
    ontologyCandidates: OntologyCandidateEntity[];
    skillCandidates: SkillCandidateEntity[];
    selectedOntologyCandidateId: string;
    selectedSkillCandidateId: string;
    loading: boolean;
  } => ({
    ontologyCandidates: ontologyCandidatesMock.candidates,
    skillCandidates: skillCandidatesMock.candidates,
    selectedOntologyCandidateId: ontologyCandidatesMock.candidates[0]?.candidate_id ?? "",
    selectedSkillCandidateId: skillCandidatesMock.candidates[0]?.skill_id ?? "",
    loading: false,
  }),
});
