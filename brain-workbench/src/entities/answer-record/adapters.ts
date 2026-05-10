import { ZodError } from "zod";
import { toAgentTraceEntity } from "@/entities/agent-trace/adapters";
import type { AskResultEntity } from "./types";
import { askResultSchema } from "./schema";

export function toAskResultEntity(payload: unknown): AskResultEntity {
  try {
    const parsed = askResultSchema.parse(payload);
    return {
      ...parsed,
      retrieval_backend: parsed.retrieval_backend ?? "legacy",
      retrieval_mode: parsed.retrieval_mode ?? "heuristic",
      retrieval_collection: parsed.retrieval_collection ?? "wiki",
      retrieval_explain: parsed.retrieval_explain ?? [],
      process_context: {
        current_stage: parsed.process_context?.current_stage ?? "",
        current_step: parsed.process_context?.current_step ?? "",
        linked_rules: parsed.process_context?.linked_rules ?? [],
        linked_cases: parsed.process_context?.linked_cases ?? [],
        linked_sources: parsed.process_context?.linked_sources ?? [],
      },
      answer_grounding_blocks: (parsed.answer_grounding_blocks ?? []).map((item) => ({
        label: item.label,
        block_type: item.block_type,
        text: item.text,
        refs: item.refs,
        stage: item.stage ?? "",
        step: item.step ?? "",
      })),
      compile_warnings: parsed.compile_warnings ?? [],
      agent_trace: toAgentTraceEntity(parsed.agent_trace, {
        retrieval: {
          backend: parsed.retrieval_backend ?? "legacy",
          mode: parsed.retrieval_mode ?? "heuristic",
          collection: parsed.retrieval_collection ?? "wiki",
          retrieval_explain: parsed.retrieval_explain ?? [],
        },
        decision: {
          question_type: parsed.question_classification.question_type,
          current_object: parsed.user_query,
          knowledge_goal: parsed.user_query,
          recommended_action: "answer",
          target_missing_slots: [],
          stop_reason: "inactive",
        },
      }),
    };
  } catch (error) {
    if (error instanceof ZodError) {
      const summary = error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("; ");
      throw new Error(`Ask result payload parse failure: ${summary}`);
    }
    throw error;
  }
}
