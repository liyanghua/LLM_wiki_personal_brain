import { useState } from "react"
import { ChevronRight, ChevronDown } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useWikiStore } from "@/stores/wiki-store"
import type { FileNode } from "@/types/wiki"
import { useTranslation } from "react-i18next"
import { getFileTreeDisplayMeta } from "@/lib/file-tree-alias"

function TreeNode({
  node,
  depth,
  projectPath,
}: {
  node: FileNode
  depth: number
  projectPath: string
}) {
  const { t } = useTranslation()
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const meta = getFileTreeDisplayMeta(t, projectPath, node.path, node.name, node.is_dir, depth)
  const [expanded, setExpanded] = useState(meta.defaultExpanded)

  const isSelected = selectedFile === node.path
  const paddingLeft = 12 + depth * 16
  const showRawName = meta.displayName !== meta.rawName

  if (node.is_dir) {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className={`flex w-full items-start gap-1 rounded-md py-1 text-left text-sm hover:bg-accent/50 hover:text-accent-foreground ${
            meta.tone === "system" ? "text-muted-foreground/85" : "text-muted-foreground"
          }`}
          style={{ paddingLeft }}
        >
          {expanded ? (
            <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <div className={`truncate ${meta.tone === "system" ? "text-muted-foreground" : ""}`}>
              {meta.displayName}
            </div>
            {showRawName && (
              <div className="truncate text-[11px] text-muted-foreground/70">
                {meta.rawName}
              </div>
            )}
          </div>
        </button>
        {expanded && node.children?.map((child) => (
          <TreeNode key={child.path} node={child} depth={depth + 1} projectPath={projectPath} />
        ))}
      </div>
    )
  }

  return (
    <button
      onClick={() => setSelectedFile(node.path)}
      className={`flex w-full items-start rounded-md py-1 text-left text-sm ${
        isSelected
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
      }`}
      style={{ paddingLeft: paddingLeft + 18 }}
      title={showRawName ? `${meta.displayName} · ${meta.rawName}` : meta.displayName}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate">{meta.displayName}</div>
        {showRawName && (
          <div className="truncate text-[11px] text-muted-foreground/70">
            {meta.rawName}
          </div>
        )}
      </div>
    </button>
  )
}

export function FileTree() {
  const { t } = useTranslation()
  const fileTree = useWikiStore((s) => s.fileTree)
  const project = useWikiStore((s) => s.project)

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
        {t("fileTree.noProject")}
      </div>
    )
  }

  return (
    <ScrollArea className="h-full min-w-0 overflow-hidden">
      <div className="p-2">
        <div className="mb-2 px-2 text-xs font-semibold uppercase text-muted-foreground">
          {project.name}
        </div>
        {fileTree.map((node) => (
          <TreeNode key={node.path} node={node} depth={0} projectPath={project.path} />
        ))}
      </div>
    </ScrollArea>
  )
}
