import { describe, expect, it } from "vitest"
import {
  inferKnowledgePageTypeFromPath,
  normalizeKnowledgePageType,
  parseKnowledgePageInfo,
} from "./knowledge-tree-classification"

describe("knowledge-tree classification", () => {
  it("normalizes page_type aliases", () => {
    expect(normalizeKnowledgePageType("business_process")).toBe("business_process")
    expect(normalizeKnowledgePageType("business_judgment")).toBe("business_judgements")
    expect(normalizeKnowledgePageType("task_generation_mechanism")).toBe("task-mechanism")
  })

  it("parses page_type when type is absent", () => {
    const info = parseKnowledgePageInfo(
      "/project/wiki/business/demo/主链路步骤.md",
      "主链路步骤.md",
      `---\npage_type: business_process\ntitle: Demo · 主链路步骤\n---\n\n# Demo`,
    )
    expect(info.type).toBe("business_process")
    expect(info.title).toBe("Demo · 主链路步骤")
  })

  it("infers task-generation categories from wiki folders", () => {
    expect(inferKnowledgePageTypeFromPath("/project/wiki/roles/role-template.md", "role-template.md")).toBe("role")
    expect(inferKnowledgePageTypeFromPath("/project/wiki/mechanisms/task-generation-mechanism.md", "task-generation-mechanism.md")).toBe("task-mechanism")
    expect(inferKnowledgePageTypeFromPath("/project/wiki/business/foo/关键判断.md", "关键判断.md")).toBe("business_judgements")
    expect(inferKnowledgePageTypeFromPath("/project/wiki/business/foo/策略总览.md", "策略总览.md")).toBe("business_strategy")
  })

  it("keeps unknown pages as other", () => {
    expect(inferKnowledgePageTypeFromPath("/project/wiki/misc/notes.md", "notes.md")).toBe("other")
  })
})
