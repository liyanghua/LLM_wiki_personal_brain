import { removeFromIngestCache } from "@/lib/ingest-cache"
import { enqueueIngest } from "@/lib/ingest-queue"
import { normalizePath, getFileName } from "@/lib/path-utils"

export async function reingestSource(projectId: string, sourcePath: string): Promise<void> {
  await enqueueIngest(projectId, sourcePath)
}

export async function reparsePdfSource(
  projectPath: string,
  projectId: string,
  sourcePath: string,
): Promise<void> {
  const sourceName = getFileName(sourcePath)
  await removeFromIngestCache(normalizePath(projectPath), sourceName)
  await enqueueIngest(projectId, sourcePath)
}

export async function reparseStructuredSource(
  projectPath: string,
  projectId: string,
  sourcePath: string,
): Promise<void> {
  const sourceName = getFileName(sourcePath)
  await removeFromIngestCache(normalizePath(projectPath), sourceName)
  await enqueueIngest(projectId, sourcePath)
}
