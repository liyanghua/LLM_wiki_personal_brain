import type { ExtractionInterviewStateEntity } from "./types";
import { extractionInterviewStateSchema } from "./schema";

export function toExtractionInterviewEntity(payload: unknown): ExtractionInterviewStateEntity {
  return extractionInterviewStateSchema.parse(payload);
}
