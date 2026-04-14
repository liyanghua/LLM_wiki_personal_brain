import type { MemoryRecentEntity } from "./types";
import { memoryRecentSchema } from "./schema";

export function toMemoryRecentEntity(payload: unknown): MemoryRecentEntity {
  const parsed = memoryRecentSchema.parse(payload);
  return {
    ...parsed,
    open_loops: parsed.open_loops.map((item) => (typeof item === "string" ? item : item.question)),
  };
}
