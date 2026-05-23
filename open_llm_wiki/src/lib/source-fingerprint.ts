import { getFileName, getRelativePath, isAbsolutePath, normalizePath } from "@/lib/path-utils"

export interface FileFingerprint {
  sourcePath: string
  sourceKey: string
  sizeBytes: number
  modifiedMs: number
  sha256?: string
  generatedAt: string
}

interface FileFingerprintStat {
  sourcePath: string
  sizeBytes: number
  modifiedMs: number
}

export function sourceKeyForPath(projectPath: string, sourcePath: string): string {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  const sp = normalizePath(sourcePath)
  if (!sp) return getFileName(sourcePath)
  if (!isAbsolutePath(sp)) return sp.replace(/^\/+/, "")
  const relative = getRelativePath(sp, pp)
  return relative === sp ? getFileName(sp) : relative
}

export async function getSourceFingerprint(
  projectPath: string,
  sourcePath: string,
): Promise<FileFingerprint> {
  const { fileFingerprint } = await import("@/commands/fs")
  const stat = await fileFingerprint(sourcePath) as FileFingerprintStat
  const normalizedSourcePath = normalizePath(stat.sourcePath || sourcePath)
  return {
    sourcePath: normalizedSourcePath,
    sourceKey: sourceKeyForPath(projectPath, normalizedSourcePath),
    sizeBytes: Number(stat.sizeBytes) || 0,
    modifiedMs: Number(stat.modifiedMs) || 0,
    generatedAt: new Date().toISOString(),
  }
}
