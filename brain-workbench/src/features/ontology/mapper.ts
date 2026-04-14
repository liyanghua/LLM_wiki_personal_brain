import { toOntologyCandidateEntity } from "@/entities/ontology-candidate/adapters";

export function mapOntologyCandidates(payload: { candidates: unknown[] }) {
  return payload.candidates.map(toOntologyCandidateEntity);
}
