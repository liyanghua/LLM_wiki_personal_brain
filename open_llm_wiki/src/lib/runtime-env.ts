import { invoke } from "@tauri-apps/api/core"

const envCache = new Map<string, string | null>()

export async function readRuntimeEnv(name: string): Promise<string | null> {
  const key = name.trim()
  if (!key) return null
  if (envCache.has(key)) {
    return envCache.get(key) ?? null
  }
  try {
    const value = await invoke<string | null>("get_runtime_env", { name: key })
    const normalized = typeof value === "string" && value.trim().length > 0 ? value.trim() : null
    envCache.set(key, normalized)
    return normalized
  } catch {
    envCache.set(key, null)
    return null
  }
}

export function primeRuntimeEnv(name: string, value: string | null | undefined): void {
  const key = name.trim()
  if (!key) return
  const normalized = typeof value === "string" && value.trim().length > 0 ? value.trim() : null
  envCache.set(key, normalized)
}
