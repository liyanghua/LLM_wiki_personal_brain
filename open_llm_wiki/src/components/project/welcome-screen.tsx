import { useEffect, useState } from "react"
import { FolderOpen, Plus, Clock, X, FileText, Layers3, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getRecentProjects, removeFromRecentProjects } from "@/lib/project-store"
import type { WikiProject } from "@/types/wiki"
import { useTranslation } from "react-i18next"

interface WelcomeScreenProps {
  onCreateProject: () => void
  onOpenProject: () => void
  onSelectProject: (project: WikiProject) => void
}

export function WelcomeScreen({
  onCreateProject,
  onOpenProject,
  onSelectProject,
}: WelcomeScreenProps) {
  const { t } = useTranslation()
  const [recentProjects, setRecentProjects] = useState<WikiProject[]>([])

  useEffect(() => {
    getRecentProjects().then(setRecentProjects).catch(() => {})
  }, [])

  async function handleRemoveRecent(e: React.MouseEvent, path: string) {
    e.stopPropagation()
    await removeFromRecentProjects(path)
    const updated = await getRecentProjects()
    setRecentProjects(updated)
  }

  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-br from-stone-50 via-background to-amber-100/70 dark:from-background dark:via-background dark:to-amber-950/20">
      <div className="grid w-full max-w-6xl gap-6 px-6 py-10 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="relative overflow-hidden rounded-[28px] border bg-background/88 p-8 shadow-sm backdrop-blur">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -left-16 top-8 h-40 w-40 rounded-full bg-amber-200/30 blur-3xl" />
            <div className="absolute right-0 top-0 h-48 w-48 rounded-full bg-orange-200/20 blur-3xl" />
          </div>

          <div className="relative space-y-8">
            <div className="space-y-4">
              <div className="inline-flex items-center rounded-full border border-amber-200/70 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900">
                面向业务专家的知识提炼工作台
              </div>
              <div className="space-y-3">
                <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
                  {t("app.title")}
                </h1>
                <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                  {t("app.subtitle")}
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border bg-white/70 p-4 dark:bg-background/60">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                  <FileText className="h-4 w-4 text-amber-600" />
                  资料进入主线
                </div>
                <p className="text-sm leading-6 text-muted-foreground">
                  围绕业务文档、会议纪要与行业材料，统一沉淀到一个工作区。
                </p>
              </div>
              <div className="rounded-2xl border bg-white/70 p-4 dark:bg-background/60">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                  <Layers3 className="h-4 w-4 text-sky-600" />
                  结构化提炼
                </div>
                <p className="text-sm leading-6 text-muted-foreground">
                  把结论、判断、证据与待确认问题分层展示，方便专家校准。
                </p>
              </div>
              <div className="rounded-2xl border bg-white/70 p-4 dark:bg-background/60">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  持续复用沉淀
                </div>
                <p className="text-sm leading-6 text-muted-foreground">
                  让每次整理、访谈和复盘都能回流成更清晰的知识页与结论资产。
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button size="lg" className="h-11 rounded-xl px-5" onClick={onCreateProject}>
                <Plus className="mr-2 h-4 w-4" />
                {t("welcome.newProject")}
              </Button>
              <Button size="lg" variant="outline" className="h-11 rounded-xl px-5" onClick={onOpenProject}>
                <FolderOpen className="mr-2 h-4 w-4" />
                {t("welcome.openProject")}
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border bg-background/70 p-4">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  推荐用法
                </div>
                <div className="mt-2 text-sm leading-6 text-foreground">
                  导入业务资料，逐步生成知识页、结论卡片与结构化问题。
                </div>
              </div>
              <div className="rounded-2xl border bg-background/70 p-4">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  适用场景
                </div>
                <div className="mt-2 text-sm leading-6 text-foreground">
                  业务访谈、行业研究、复盘沉淀、方法总结与共识对齐。
                </div>
              </div>
              <div className="rounded-2xl border bg-background/70 p-4">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  默认心智
                </div>
                <div className="mt-2 text-sm leading-6 text-foreground">
                  先形成业务理解，再沉淀知识结构，而不是堆一堆零散聊天记录。
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside className="rounded-[28px] border bg-background/92 p-6 shadow-sm backdrop-blur">
          <div className="mb-5">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Clock className="h-4 w-4 text-muted-foreground" />
              {t("welcome.recentProjects")}
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              从最近的业务工作区继续，或者新建一个围绕资料、问题与结论的知识工作台。
            </p>
          </div>

          {recentProjects.length > 0 ? (
            <div className="rounded-2xl border">
              {recentProjects.map((proj) => (
                <button
                  key={proj.path}
                  onClick={() => onSelectProject(proj)}
                  className="group flex w-full items-center justify-between border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-accent"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{proj.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {proj.path}
                    </div>
                  </div>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={(e) => handleRemoveRecent(e, proj.path)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRemoveRecent(e as unknown as React.MouseEvent, proj.path)
                    }}
                    className="ml-2 shrink-0 rounded p-1 opacity-0 transition-opacity hover:bg-destructive/10 group-hover:opacity-100"
                    aria-label={`移除最近工作区 ${proj.name}`}
                  >
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed p-5">
              <div className="text-sm font-medium text-foreground">第一次使用建议这样开始</div>
              <ol className="mt-3 space-y-3 text-sm leading-6 text-muted-foreground">
                <li>1. 新建一个业务工作区，明确主题、目标和产出范围。</li>
                <li>2. 导入业务文档、访谈纪要或结构化材料，形成统一资料底座。</li>
                <li>3. 通过业务问答、知识页和质量检查，逐步收敛高价值结论。</li>
              </ol>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
