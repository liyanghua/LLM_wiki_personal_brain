import { describe, expect, it } from "vitest"
import type { FileNode } from "@/types/wiki"
import {
  buildRecompileBatchOptions,
  collectRecompilableSourceFiles,
  describeRecompileMode,
} from "./sources-recompile"

describe("sources recompile helpers", () => {
  it("collects supported source files recursively while skipping hidden caches and media", () => {
    const tree: FileNode[] = [
      {
        name: "task_gen_engine",
        path: "/project/raw/sources/task_gen_engine",
        is_dir: true,
        children: [
          { name: "机制.md", path: "/project/raw/sources/task_gen_engine/机制.md", is_dir: false },
          { name: "岗位.xlsx", path: "/project/raw/sources/task_gen_engine/岗位.xlsx", is_dir: false },
          { name: "海报.png", path: "/project/raw/sources/task_gen_engine/海报.png", is_dir: false },
          {
            name: ".cache",
            path: "/project/raw/sources/task_gen_engine/.cache",
            is_dir: true,
            children: [
              { name: "岗位.xlsx.txt", path: "/project/raw/sources/task_gen_engine/.cache/岗位.xlsx.txt", is_dir: false },
            ],
          },
          {
            name: "周会",
            path: "/project/raw/sources/task_gen_engine/周会",
            is_dir: true,
            children: [
              { name: "月会.xls", path: "/project/raw/sources/task_gen_engine/周会/月会.xls", is_dir: false },
              { name: "视频.mp4", path: "/project/raw/sources/task_gen_engine/周会/视频.mp4", is_dir: false },
            ],
          },
        ],
      },
    ]

    expect(collectRecompilableSourceFiles(tree).map((node) => node.path)).toEqual([
      "/project/raw/sources/task_gen_engine/机制.md",
      "/project/raw/sources/task_gen_engine/岗位.xlsx",
      "/project/raw/sources/task_gen_engine/周会/月会.xls",
    ])
  })
})

describe("recompile mode helpers", () => {
  it("uses core extraction as the default mode and skips strategy compilation", () => {
    expect(describeRecompileMode("core")).toMatchObject({
      label: "核心抽取",
      strategyCompileMode: "skip",
      runsStrategyCompile: false,
    })
    expect(buildRecompileBatchOptions("core")).toEqual({
      deferPostProcessing: true,
      qualityMode: "balanced",
      strategyCompileMode: "skip",
      runStrategyEnhancement: false,
    })
  })

  it("uses deferred strategy compilation for full enhancement mode", () => {
    expect(describeRecompileMode("full")).toMatchObject({
      label: "完整增强",
      strategyCompileMode: "deferred",
      runsStrategyCompile: true,
    })
    expect(buildRecompileBatchOptions("full")).toEqual({
      deferPostProcessing: true,
      qualityMode: "balanced",
      strategyCompileMode: "deferred",
      runStrategyEnhancement: true,
    })
  })
})
