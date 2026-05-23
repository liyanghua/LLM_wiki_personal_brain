import type { FileNode } from "@/types/wiki"
import type { AutoIngestOptions, StrategyCompileMode } from "@/lib/ingest-options"

export type SourcesRecompileMode = "core" | "full"

export interface RecompileModeDescription {
  mode: SourcesRecompileMode
  label: string
  shortLabel: string
  description: string
  estimate: string
  strategyCompileMode: StrategyCompileMode
  runsStrategyCompile: boolean
  runsEmbeddings: boolean
  stages: string[]
  skippedStages: string[]
}

const RECOMPILABLE_EXTS = new Set([
  "md",
  "mdx",
  "txt",
  "rtf",
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ods",
  "csv",
  "tsv",
  "xmind",
  "html",
  "htm",
  "xml",
  "json",
  "jsonl",
  "yaml",
  "yml",
  "ndjson",
])

function fileExt(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? ""
}

export function isRecompilableSourceFile(node: FileNode): boolean {
  if (node.is_dir) return false
  if (node.name.startsWith(".")) return false
  return RECOMPILABLE_EXTS.has(fileExt(node.path))
}

export function collectRecompilableSourceFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.name.startsWith(".")) continue
    if (node.is_dir) {
      files.push(...collectRecompilableSourceFiles(node.children ?? []))
      continue
    }
    if (isRecompilableSourceFile(node)) files.push(node)
  }
  return files
}

export function describeRecompileMode(mode: SourcesRecompileMode): RecompileModeDescription {
  if (mode === "full") {
    return {
      mode,
      label: "完整增强",
      shortLabel: "策略/Skill 准备",
      description: "先完成核心 Wiki 与任务卡，再在批量后处理阶段统一运行策略编译和向量增强。",
      estimate: "约 1h30m+（取决于策略卡 LLM 耗时）",
      strategyCompileMode: "deferred",
      runsStrategyCompile: true,
      runsEmbeddings: true,
      stages: ["文档解析", "结构化抽取", "Wiki/任务卡编译", "语义索引", "任务索引", "质量报告", "策略编译", "向量索引", "Review 刷新"],
      skippedStages: [],
    }
  }
  return {
    mode,
    label: "核心抽取",
    shortLabel: "推荐：先拿任务卡",
    description: "跳过策略编译，优先刷新 Wiki、任务卡、语义索引、任务索引和质量报告。",
    estimate: "约 50-60m（基于最近 11 份文档历史）",
    strategyCompileMode: "skip",
    runsStrategyCompile: false,
    runsEmbeddings: false,
    stages: ["文档解析", "结构化抽取", "Wiki/任务卡编译", "语义索引", "任务索引", "质量报告", "Review 刷新"],
    skippedStages: ["策略编译", "向量索引"],
  }
}

export function buildRecompileBatchOptions(mode: SourcesRecompileMode): Pick<
  AutoIngestOptions,
  "deferPostProcessing" | "qualityMode" | "strategyCompileMode" | "runStrategyEnhancement"
> {
  const description = describeRecompileMode(mode)
  return {
    deferPostProcessing: true,
    qualityMode: "balanced",
    strategyCompileMode: description.strategyCompileMode,
    runStrategyEnhancement: description.runsStrategyCompile,
  }
}
