import {
  enterResearchWorkbench,
  runDeepResearchSession,
} from "@/lib/deep-research"
import type {
  ResearchTaskRequest,
  ResearchTaskResult,
} from "@/lib/research-types"
import { normalizePath } from "@/lib/path-utils"
import { useResearchStore } from "@/stores/research-store"

export class ResearchTaskRunner {
  async run(projectPath: string, request: ResearchTaskRequest): Promise<ResearchTaskResult> {
    const sessionId = enterResearchWorkbench({
      taskType: request.taskType,
      topic: request.topic,
      businessContext: request.businessContext ?? null,
      targetMarket: request.targetMarket ?? null,
      targetAudience: request.targetAudience ?? null,
      constraints: request.constraints ?? null,
      seedQuestions: request.seedQuestions ?? [],
      breadth: request.breadth,
      depth: request.depth,
      linkedDocId: request.linkedDocId ?? null,
      targetFieldKey: request.targetFieldKey ?? null,
      triggerSource: request.taskType,
    })
    await runDeepResearchSession(sessionId, normalizePath(projectPath))
    const session = useResearchStore.getState().sessions.find((item) => item.sessionId === sessionId)
    if (!session) {
      throw new Error(`Research session not found after run: ${sessionId}`)
    }
    return {
      session,
      sources: session.sources,
      learnings: session.learnings,
      reportMarkdown: session.reportMarkdown,
      findings: session.findings,
      opportunityCards: session.opportunityCards ?? [],
      warnings: session.providerStatus?.degraded || session.runtime.providerStatus?.degraded
        ? [session.providerStatus?.detail || session.runtime.providerStatus?.detail || "研究过程存在降级。"]
        : [],
      degraded: Boolean(session.providerStatus?.degraded || session.runtime.providerStatus?.degraded),
    }
  }
}

export const researchTaskRunner = new ResearchTaskRunner()
