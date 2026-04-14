import type { MethodProfileEntity } from "./types";
import { methodProfileSchema } from "./schema";

export function toMethodProfileEntity(payload: unknown): MethodProfileEntity {
  return methodProfileSchema.parse(payload);
}
