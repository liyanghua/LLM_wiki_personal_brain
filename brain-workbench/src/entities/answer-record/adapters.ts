import type { AskResultEntity } from "./types";
import { askResultSchema } from "./schema";

export function toAskResultEntity(payload: unknown): AskResultEntity {
  return askResultSchema.parse(payload);
}
