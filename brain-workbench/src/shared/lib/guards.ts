import { createPinia, getActivePinia, setActivePinia } from "pinia";

export function ensurePinia() {
  if (!getActivePinia()) {
    setActivePinia(createPinia());
  }
}

export function resolvePinia() {
  ensurePinia();
  return getActivePinia();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
