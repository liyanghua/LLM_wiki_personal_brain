import { useEffect, useCallback, useMemo, useRef, useState } from "react"
import { X, BookOpen, FileCog, Trash2, Sparkles } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { readFile, writeFile, listDirectory, deleteFile, findRelatedWikiPages } from "@/commands/fs"
import { getFileCategory, isBinary } from "@/lib/file-types"
import { WikiEditor } from "@/components/editor/wiki-editor"
import { FilePreview } from "@/components/editor/file-preview"
import { getFileName, normalizePath } from "@/lib/path-utils"
import { Button } from "@/components/ui/button"
import { reingestSource, reparseStructuredSource } from "@/lib/source-actions"
import { removeFromIngestCache } from "@/lib/ingest-cache"
import { parseSources, writeSources } from "@/lib/sources-merge"
import { decidePageFate } from "@/lib/source-delete-decision"
import { collectAllFilesIncludingDot } from "@/lib/sources-tree-delete"
import type { FileNode } from "@/types/wiki"

export function PreviewPanel() {
  const project = useWikiStore((s) => s.project)
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const fileContent = useWikiStore((s) => s.fileContent)
  const setFileContent = useWikiStore((s) => s.setFileContent)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const fileTree = useWikiStore((s) => s.fileTree)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [workingAction, setWorkingAction] = useState<"ingest" | "reparse" | "delete" | null>(null)
  // Snapshot of what was most recently loaded from disk. Milkdown re-emits
  // `markdownUpdated` on initial parse (before the user types anything),
  // which used to trigger an auto-save that could write back a placeholder
  // marker if read_file had returned one for a missing/locked file. We
  // skip save when the incoming markdown equals the last-loaded content.
  const lastLoadedRef = useRef<string>("")

  useEffect(() => {
    if (!selectedFile) {
      setFileContent("")
      lastLoadedRef.current = ""
      return
    }

    const category = getFileCategory(selectedFile)

    if (isBinary(category)) {
      setFileContent("")
      lastLoadedRef.current = ""
      return
    }

    readFile(selectedFile)
      .then((content) => {
        lastLoadedRef.current = content
        setFileContent(content)
      })
      .catch((err) => {
        lastLoadedRef.current = ""
        setFileContent(`Error loading file: ${err}`)
      })
  }, [selectedFile, setFileContent])

  const handleSave = useCallback(
    (markdown: string) => {
      if (!selectedFile) return
      // Ignore no-op saves from the editor's initial re-emit. Only write
      // when the user has actually changed the content relative to the
      // last disk read.
      if (markdown === lastLoadedRef.current) return
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        writeFile(selectedFile, markdown)
          .then(() => {
            // Our own write becomes the new "last loaded" — subsequent
            // re-emits from Milkdown that match this content must not
            // trigger another save.
            lastLoadedRef.current = markdown
          })
          .catch((err) => console.error("Failed to save:", err))
      }, 1000)
    },
    [selectedFile]
  )

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  if (!selectedFile) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a file to preview
      </div>
    )
  }

  const category = getFileCategory(selectedFile)
  const fileName = getFileName(selectedFile)
  const isStructuredDocument = /\.(pdf|docx|doc|xmind)$/i.test(selectedFile)
  const structuredLabel = selectedFile.split(".").pop()?.toUpperCase() ?? "文档"
  const sourceNode = useMemo(() => {
    if (!project || !selectedFile) return null
    return findNodeByPath(fileTree, selectedFile)
  }, [project, selectedFile, fileTree])

  const handleIngest = useCallback(async () => {
    if (!project || !selectedFile || workingAction) return
    setWorkingAction("ingest")
    try {
      await reingestSource(project.id, selectedFile)
      useWikiStore.getState().bumpDataVersion()
    } catch (err) {
      console.error("Failed to re-ingest source:", err)
    } finally {
      setWorkingAction(null)
    }
  }, [project, selectedFile, workingAction])

  const handleReparseStructured = useCallback(async () => {
    if (!project || !selectedFile || !isStructuredDocument || workingAction) return
    setWorkingAction("reparse")
    try {
      await reparseStructuredSource(project.path, project.id, selectedFile)
      useWikiStore.getState().bumpDataVersion()
    } catch (err) {
      console.error("Failed to reparse structured source:", err)
    } finally {
      setWorkingAction(null)
    }
  }, [project, selectedFile, isStructuredDocument, workingAction])

  const handleDelete = useCallback(async () => {
    if (!project || !selectedFile || workingAction) return
    const confirmed = window.confirm(`确认删除资料「${fileName}」以及它关联的知识页吗？`)
    if (!confirmed) return
    setWorkingAction("delete")
    try {
      const node = sourceNode ?? {
        name: fileName,
        path: selectedFile,
        is_dir: false,
      }
      await deleteSourceWithCascade(normalizePath(project.path), node)
      const tree = await listDirectory(normalizePath(project.path))
      setFileTree(tree)
      useWikiStore.getState().bumpDataVersion()
      setSelectedFile(null)
    } catch (err) {
      console.error("Failed to delete source from preview panel:", err)
      window.alert(`删除失败：${err}`)
    } finally {
      setWorkingAction(null)
    }
  }, [project, selectedFile, workingAction, fileName, sourceNode, setFileTree, setSelectedFile])

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground" title={fileName}>
              {fileName}
            </div>
            <span className="truncate text-xs text-muted-foreground" title={selectedFile}>
              {selectedFile}
            </span>
          </div>
          <button
            onClick={() => setSelectedFile(null)}
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent"
            title="关闭预览"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleIngest()}
            disabled={workingAction !== null}
          >
            <BookOpen className="h-3.5 w-3.5" />
            生成知识页
          </Button>
          {isStructuredDocument && (
            <Button
              variant="default"
              size="sm"
              onClick={() => void handleReparseStructured()}
              disabled={workingAction !== null}
            >
              <FileCog className="h-3.5 w-3.5" />
              {`重新解析 ${structuredLabel}`}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleDelete()}
            disabled={workingAction !== null}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            删除资料
          </Button>
          {isStructuredDocument && (
            <div className="inline-flex items-center gap-1 rounded-full bg-primary/8 px-2 py-1 text-[11px] text-primary">
              <Sparkles className="h-3 w-3" />
              {`${structuredLabel} 增强理解可在这里手动重跑`}
            </div>
          )}
        </div>
      </div>
      <div className="flex-1 min-w-0 overflow-auto">
        {category === "markdown" ? (
          <WikiEditor
            key={selectedFile}
            content={fileContent}
            onSave={handleSave}
          />
        ) : (
          <FilePreview
            key={selectedFile}
            filePath={selectedFile}
            textContent={fileContent}
          />
        )}
      </div>
    </div>
  )
}

function findNodeByPath(nodes: FileNode[], targetPath: string): FileNode | null {
  for (const node of nodes) {
    if (node.path === targetPath) return node
    if (node.is_dir && node.children) {
      const found = findNodeByPath(node.children, targetPath)
      if (found) return found
    }
  }
  return null
}

async function deleteSourceWithCascade(
  projectPath: string,
  node: FileNode,
): Promise<void> {
  if (node.is_dir && node.children) {
    const allFiles = collectAllFilesIncludingDot(node)
    for (const file of allFiles) {
      await deleteSourceWithCascade(projectPath, file)
    }
    try {
      await deleteFile(node.path)
    } catch {
      // folder may already be gone after children cleanup
    }
    return
  }

  const relatedPages = await findRelatedWikiPages(projectPath, node.name)
  await deleteFile(node.path)

  try {
    await deleteFile(`${projectPath}/raw/sources/.cache/${node.name}.txt`)
  } catch {
    // non-critical
  }

  const pagesToDelete: string[] = []
  for (const pagePath of relatedPages) {
    try {
      const content = await readFile(pagePath)
      const sourcesList = parseSources(content)
      const decision = decidePageFate(sourcesList, node.name)

      if (decision.action === "skip") continue
      if (decision.action === "keep") {
        await writeFile(pagePath, writeSources(content, decision.updatedSources))
        continue
      }
      pagesToDelete.push(pagePath)
    } catch (err) {
      console.error(`Failed to process wiki page ${pagePath}:`, err)
    }
  }

  if (pagesToDelete.length > 0) {
    const { cascadeDeleteWikiPagesWithRefs } = await import("@/lib/wiki-page-delete")
    await cascadeDeleteWikiPagesWithRefs(projectPath, pagesToDelete)
  }

  try {
    await removeFromIngestCache(projectPath, node.name)
  } catch {
    // non-critical
  }
}
