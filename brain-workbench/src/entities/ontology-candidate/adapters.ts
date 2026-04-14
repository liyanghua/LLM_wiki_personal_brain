import type { OntologyCandidateEntity } from "./types";
import { ontologyCandidateSchema } from "./schema";

export function toOntologyCandidateEntity(payload: unknown): OntologyCandidateEntity {
  return ontologyCandidateSchema.parse(payload);
}
