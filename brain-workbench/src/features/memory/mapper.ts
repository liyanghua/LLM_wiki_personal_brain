import { toMemoryRecentEntity } from "@/entities/memory-item/adapters";

export function mapRecentMemory(payload: unknown) {
  return toMemoryRecentEntity(payload);
}
