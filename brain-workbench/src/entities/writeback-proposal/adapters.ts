import type { WritebackBundleEntity } from "./types";
import { writebackBundleSchema } from "./schema";

export function toWritebackBundleEntity(payload: unknown): WritebackBundleEntity {
  return writebackBundleSchema.parse(payload);
}
