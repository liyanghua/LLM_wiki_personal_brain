import { defineStore } from "pinia";
import type { OntologyCandidateEntity } from "@/entities/ontology-candidate/types";
import type { SkillCandidateEntity } from "@/entities/skill-candidate/types";

export const useAssetsStore = defineStore("assets", {
  state: (): {
    ontologyCandidates: OntologyCandidateEntity[];
    skillCandidates: SkillCandidateEntity[];
    selectedOntologyCandidateId: string;
    selectedSkillCandidateId: string;
    loading: boolean;
    error: string;
  } => ({
    ontologyCandidates: [],
    skillCandidates: [],
    selectedOntologyCandidateId: "",
    selectedSkillCandidateId: "",
    loading: false,
    error: "",
  }),
});
