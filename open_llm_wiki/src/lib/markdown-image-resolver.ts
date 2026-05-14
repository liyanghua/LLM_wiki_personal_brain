/**
 * Resolve markdown image `src` attributes so they actually load in
 * the Tauri webview.
 *
 * The problem: ingest writes images to `<project>/wiki/media/<slug>/`
 * and embeds them in generated wiki pages as
 * `![](media/<slug>/img-1.png)`. A markdown renderer interprets that
 * relative to the rendering page's URL — but in Tauri there IS no
 * URL context for arbitrary file paths, AND the wiki page may be
 * located deeper than `wiki/concepts/foo.md` so naive `../media/...`
 * fixups don't generalize.
 *
 * Convention we settle on:
 *
 *   - Any src starting with `http://`, `https://`, `data:`, `blob:`,
 *     `file:`, `tauri://` is passed through unchanged.
 *   - Any src starting with `/` (absolute) is wrapped with
 *     `convertFileSrc` directly — the path is the filesystem
 *     absolute path.
 *   - **Anything else is treated as relative to the project's
 *     `wiki/` root.** Generated content uses this form
 *     (`media/foo/img-1.png`); user-written content can use it too.
 *
 * The resolver returns a string that React's <img src=...> can load:
 * the appropriate `convertFileSrc(...)` URL or the original src
 * verbatim.
 */
import { convertFileSrc } from "@tauri-apps/api/core"
import { normalizePath } from "@/lib/path-utils"

const PASSTHROUGH_RE = /^(https?:|data:|blob:|file:|tauri:)/i

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[a-zA-Z]:/.test(path) || path.startsWith("\\\\")
}

export function normalizeLocalImagePath(rawPath: string): string {
  const normalized = normalizePath(rawPath.trim()).replace(/^\.\//, "")
  if (!/%[0-9a-f]{2}/i.test(normalized)) return normalized
  try {
    return decodeURIComponent(normalized)
  } catch {
    return normalized
  }
}

export function resolveEvidenceImageFilePath(
  projectPath: string | null,
  relPath: string,
): string | null {
  if (!relPath) return null
  if (PASSTHROUGH_RE.test(relPath)) return null

  const cleaned = normalizeLocalImagePath(relPath)
  if (isAbsolutePath(cleaned)) return cleaned
  if (!projectPath) return cleaned

  const pp = normalizePath(projectPath)
  if (cleaned.startsWith("wiki/")) return `${pp}/${cleaned}`
  return `${pp}/wiki/${cleaned}`
}

/**
 * `projectPath` is the wiki project's root directory. When null
 * (no project loaded), the resolver passes srcs through unchanged
 * so it remains safe to call before a project is open.
 */
export function resolveMarkdownImageSrc(
  rawSrc: string,
  projectPath: string | null,
): string {
  if (!rawSrc) return rawSrc
  if (PASSTHROUGH_RE.test(rawSrc)) return rawSrc

  if (!projectPath) return rawSrc

  const pp = normalizePath(projectPath)
  const isAbsolute = isAbsolutePath(rawSrc)

  // Absolute paths get fed straight to convertFileSrc — the user (or
  // some plugin) explicitly chose that path; we don't second-guess.
  if (isAbsolute) return convertFileSrc(rawSrc)

  // Strip a leading `./` for cleanliness; treat `media/foo.png` and
  // `./media/foo.png` identically.
  const cleaned = normalizeLocalImagePath(rawSrc)

  // Some enhanced document-preparation outputs already store paths as
  // `wiki/media/...` (project-root relative), while the wiki pages
  // themselves usually emit `media/...` (wiki-root relative). Support
  // both so raw-source preview and compiled wiki preview share the same
  // resolver without path drift.
  if (cleaned.startsWith("wiki/")) {
    return convertFileSrc(`${pp}/${cleaned}`)
  }

  // Resolve as wiki-root-relative. The markdown lives somewhere
  // under wiki/ but we ignore its location — image references in
  // generated content always use this convention so the path is
  // stable regardless of page depth.
  const absolute = `${pp}/wiki/${cleaned}`
  return convertFileSrc(absolute)
}
