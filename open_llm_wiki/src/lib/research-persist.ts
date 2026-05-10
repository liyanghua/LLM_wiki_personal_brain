import { createDirectory, fileExists, listDirectory, readFile, writeFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import type { ResearchSession } from "@/lib/research-types"

async function ensureResearchDir(projectPath: string): Promise<string> {
  const pp = normalizePath(projectPath)
  await createDirectory(`${pp}/wiki`).catch(() => {})
  await createDirectory(`${pp}/wiki/research`).catch(() => {})
  return `${pp}/wiki/research`
}

function sanitizeSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 48) || "research"
}

export async function ensureResearchArtifactDir(
  projectPath: string,
  session: Pick<ResearchSession, "topic" | "sessionId">,
): Promise<string> {
  const root = await ensureResearchDir(projectPath)
  const dir = `${root}/${sanitizeSlug(session.topic)}-${session.sessionId}`
  await createDirectory(dir).catch(() => {})
  return dir
}

export async function saveResearchSession(
  projectPath: string,
  session: ResearchSession,
): Promise<ResearchSession> {
  const dir = session.artifactDir ?? await ensureResearchArtifactDir(projectPath, session)
  const updated: ResearchSession = {
    ...session,
    artifactDir: dir,
    reportPath: `${dir}/report.md`,
    sessionPath: `${dir}/session.json`,
    sourcesPath: `${dir}/sources.json`,
    notesPath: `${dir}/notes.md`,
  }

  await writeFile(updated.sessionPath!, JSON.stringify(updated, null, 2))
  await writeFile(updated.sourcesPath!, JSON.stringify(updated.sources, null, 2))
  await writeFile(updated.notesPath!, updated.notesMarkdown || "")
  if (updated.reportMarkdown.trim()) {
    await writeFile(updated.reportPath!, updated.reportMarkdown)
  }

  return updated
}

export async function loadResearchSessions(projectPath: string): Promise<ResearchSession[]> {
  const root = `${normalizePath(projectPath)}/wiki/research`
  const exists = await fileExists(root).catch(() => false)
  if (!exists) return []

  const dirs = await listDirectory(root).catch(() => [])
  const sessions: ResearchSession[] = []
  for (const node of dirs) {
    if (!node.is_dir) continue
    const sessionPath = `${node.path}/session.json`
    const hasSession = await fileExists(sessionPath).catch(() => false)
    if (!hasSession) continue
    try {
      const content = await readFile(sessionPath)
      sessions.push(JSON.parse(content) as ResearchSession)
    } catch {
      // ignore broken session file
    }
  }

  return sessions.sort((a, b) => b.updatedAt - a.updatedAt)
}
