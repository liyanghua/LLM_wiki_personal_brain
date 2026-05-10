import { ZodError } from "zod";
import { toAgentTraceEntity } from "@/entities/agent-trace/adapters";
import type { ExtractionInterviewStateEntity } from "./types";
import { extractionInterviewStateSchema } from "./schema";

const DEFAULT_STOP_IF = [
  "all target missing slots are filled",
  "the user says the interview has enough context",
];

export function toExtractionInterviewEntity(payload: unknown): ExtractionInterviewStateEntity {
  try {
    const parsed = extractionInterviewStateSchema.parse(payload);
    const missingSlots = parsed.missing_slots ?? [];
    const knownSlots = parsed.known_slots ?? {};
    const shouldStop = parsed.status === "completed" || missingSlots.length === 0;
    const projectedWritebackLevel =
      parsed.status === "completed" && missingSlots.length === 0 && Object.keys(knownSlots).length >= 4
        ? "asset-level"
        : parsed.status === "completed" || parsed.turn_index >= 2
          ? "knowledge-level"
          : "session-level";
    const retrievalFallback = {
      backend: parsed.retrieval_buckets?.retrieval_backend ?? "legacy",
      mode: parsed.retrieval_buckets?.retrieval_mode ?? "heuristic",
      collection: parsed.retrieval_buckets?.retrieval_collection ?? "wiki",
      retrieval_explain: parsed.retrieval_buckets?.retrieval_explain ?? [],
      wiki_hits: parsed.retrieval_buckets?.ranked_page_paths?.filter((path) => path.startsWith("wiki/")) ?? [],
      raw_hits:
        parsed.retrieval_buckets?.evidence_pages
          ?.map((item) => item.page_path)
          .filter((path) => path.startsWith("raw/")) ?? [],
    };
    const decisionFallback = {
      question_type: parsed.question_type,
      current_object: parsed.current_object,
      knowledge_goal: parsed.current_knowledge_goal,
      recommended_action: parsed.stop_decision?.should_stop ? "write_back" : "ask_follow_up",
      target_missing_slots: parsed.next_question_plan?.target_missing_slots ?? missingSlots,
      stop_reason:
        parsed.stop_decision?.reason ??
        (parsed.status === "completed" ? "completed-state" : shouldStop ? "all-required-slots-filled" : "continue"),
    };
    const session = {
      session_id: parsed.session?.session_id ?? parsed.interview_id,
      title: parsed.session?.title ?? parsed.current_knowledge_goal ?? parsed.current_object ?? parsed.interview_id,
      topic_type: parsed.session?.topic_type ?? parsed.question_type ?? "topic",
      target_object: parsed.session?.target_object ?? parsed.current_object ?? "",
      goal: parsed.session?.goal ?? parsed.current_knowledge_goal ?? "",
      status: parsed.session?.status ?? parsed.status,
      created_by: parsed.session?.created_by ?? "expert",
      created_at: parsed.session?.created_at ?? "",
      completed_at: parsed.session?.completed_at ?? "",
      current_stage: parsed.session?.current_stage ?? parsed.current_stage ?? parsed.process_context?.current_stage ?? "",
      current_step: parsed.session?.current_step ?? parsed.current_step ?? parsed.process_context?.current_step ?? "",
    };
    const candidateAssets = (parsed.candidate_assets ?? []).map((asset) => ({
      asset_id: asset.asset_id,
      session_id: asset.session_id,
      asset_type: asset.asset_type,
      title: asset.title,
      summary: asset.summary,
      content_json: asset.content_json ?? {},
      confidence: asset.confidence,
      source_turn_ids: asset.source_turn_ids ?? [],
      evidence_refs: asset.evidence_refs ?? [],
      status: asset.status ?? "draft",
      expert_note: asset.expert_note ?? "",
      stage_refs: asset.stage_refs ?? [],
      step_refs: asset.step_refs ?? [],
      decision_refs: asset.decision_refs ?? [],
      card_group: asset.card_group ?? asset.asset_type,
      card_order: asset.card_order ?? 0,
      anchor_block_refs: asset.anchor_block_refs ?? [],
    }));
    const followupQuestions = (parsed.followup_questions ?? []).map((item, index) => ({
      question_id: item.question_id,
      session_id: item.session_id,
      question_text: item.question_text,
      question_type: item.question_type,
      reason: item.reason,
      priority: item.priority ?? (index === 0 ? "high" : "medium"),
      status: item.status ?? (index === 0 ? "selected" : "open"),
      source_asset_ids: item.source_asset_ids ?? [],
      target_missing_slots: item.target_missing_slots ?? [],
      linked_stage: item.linked_stage ?? parsed.current_stage ?? parsed.process_context?.current_stage ?? "",
      linked_step: item.linked_step ?? parsed.current_step ?? parsed.process_context?.current_step ?? "",
      gap_type: item.gap_type ?? "judgement_gap",
    }));
    const sessionSummary = {
      summary_id: parsed.session_summary?.summary_id ?? `summary-${parsed.interview_id}`,
      session_id: parsed.session_summary?.session_id ?? parsed.interview_id,
      summary_text: parsed.session_summary?.summary_text ?? parsed.current_answer_summary ?? "",
      key_concepts: parsed.session_summary?.key_concepts ?? [],
      key_heuristics: parsed.session_summary?.key_heuristics ?? [],
      key_cases: parsed.session_summary?.key_cases ?? [],
      key_boundaries: parsed.session_summary?.key_boundaries ?? [],
      unresolved_items: parsed.session_summary?.unresolved_items ?? missingSlots,
    };
    const interviewView = {
      current_prompt:
        parsed.interview_view?.current_prompt ??
        parsed.next_question_plan?.candidate_questions?.[0] ??
        parsed.followup_questions?.[0]?.question_text ??
        "",
      prompt_type_label: parsed.interview_view?.prompt_type_label ?? "当前在问：知识榨取",
      phase_label:
        parsed.interview_view?.phase_label ??
        (parsed.status === "completed"
          ? "已完成"
          : parsed.current_stage || parsed.process_context?.current_stage
            ? `正在围绕 ${parsed.current_stage ?? parsed.process_context?.current_stage} 推进`
            : "正在建立主题"),
      recommended_followups:
        parsed.interview_view?.recommended_followups ??
        parsed.next_question_plan?.candidate_questions?.slice(0, 4) ??
        [],
      structure_counts: {
        concepts: parsed.interview_view?.structure_counts?.concepts ?? candidateAssets.filter((item) => item.asset_type === "concept" && item.status !== "rejected").length,
        heuristics:
          parsed.interview_view?.structure_counts?.heuristics ??
          candidateAssets.filter((item) => item.asset_type === "heuristic" && item.status !== "rejected").length,
        cases:
          parsed.interview_view?.structure_counts?.cases ??
          candidateAssets.filter((item) => item.asset_type === "case" && item.status !== "rejected").length,
        boundaries:
          parsed.interview_view?.structure_counts?.boundaries ??
          candidateAssets.filter((item) => item.asset_type === "boundary" && item.status !== "rejected").length,
      },
      answer_frame: {
        primary_answer: parsed.interview_view?.answer_frame?.primary_answer ?? parsed.current_answer_summary ?? "",
        mainline_steps: parsed.interview_view?.answer_frame?.mainline_steps ?? [],
        key_judgements: parsed.interview_view?.answer_frame?.key_judgements ?? [],
        evidence_refs: parsed.interview_view?.answer_frame?.evidence_refs ?? [],
      },
      can_skip: parsed.interview_view?.can_skip ?? parsed.status !== "completed",
      can_summarize: parsed.interview_view?.can_summarize ?? parsed.status !== "completed",
      autosave_state: parsed.interview_view?.autosave_state ?? (parsed.state_path ? "saved" : "pending"),
    };
    const autosaveState = {
      saved: parsed.autosave_state?.saved ?? Boolean(parsed.state_path),
      state_path: parsed.autosave_state?.state_path ?? parsed.state_path ?? "",
      updated_at: parsed.autosave_state?.updated_at ?? "",
      status: parsed.autosave_state?.status ?? (parsed.state_path ? "saved" : "pending"),
    };
    const degradedRetrievalMode = {
      active: parsed.degraded_retrieval_mode?.active ?? false,
      configured_backend: parsed.degraded_retrieval_mode?.configured_backend ?? "qmd",
      actual_backend:
        parsed.degraded_retrieval_mode?.actual_backend ??
        parsed.retrieval_buckets?.retrieval_backend ??
        "legacy",
      reason: parsed.degraded_retrieval_mode?.reason ?? "",
    };

    return {
      ...parsed,
      session,
      current_stage: parsed.current_stage ?? parsed.process_context?.current_stage ?? "",
      current_step: parsed.current_step ?? parsed.process_context?.current_step ?? "",
      process_context: {
        current_stage: parsed.process_context?.current_stage ?? parsed.current_stage ?? "",
        current_step: parsed.process_context?.current_step ?? parsed.current_step ?? "",
        linked_rules: parsed.process_context?.linked_rules ?? [],
        linked_cases: parsed.process_context?.linked_cases ?? [],
        linked_sources: parsed.process_context?.linked_sources ?? [],
        anchor_bundle_id: parsed.process_context?.anchor_bundle_id ?? "",
        anchor_paths: parsed.process_context?.anchor_paths ?? [],
        matched_block_ids: parsed.process_context?.matched_block_ids ?? [],
        answer_mode: parsed.process_context?.answer_mode ?? "",
      },
      retrieval_buckets: {
        object_pages: parsed.retrieval_buckets?.object_pages ?? [],
        evidence_pages: parsed.retrieval_buckets?.evidence_pages ?? [],
        conversation_hits: parsed.retrieval_buckets?.conversation_hits ?? [],
        pattern_hits: parsed.retrieval_buckets?.pattern_hits ?? [],
        ranked_page_paths: parsed.retrieval_buckets?.ranked_page_paths ?? [],
        retrieved_sources: parsed.retrieval_buckets?.retrieved_sources ?? [],
      },
      next_question_plan: {
        next_question_type: parsed.next_question_plan?.next_question_type ?? (shouldStop ? "stop" : "slot-fill"),
        candidate_questions: parsed.next_question_plan?.candidate_questions ?? [],
        target_missing_slots: parsed.next_question_plan?.target_missing_slots ?? missingSlots,
        stop_if: parsed.next_question_plan?.stop_if ?? DEFAULT_STOP_IF,
      },
      stop_decision: {
        should_stop: parsed.stop_decision?.should_stop ?? shouldStop,
        reason:
          parsed.stop_decision?.reason ??
          (parsed.status === "completed" ? "completed-state" : shouldStop ? "all-required-slots-filled" : "continue"),
        confidence: parsed.stop_decision?.confidence ?? (shouldStop ? 0.95 : 0.8),
      },
      staged_writeback: {
        session_level: parsed.staged_writeback?.session_level ?? {
          interview_id: parsed.interview_id,
          turn_index: parsed.turn_index,
          known_slots: knownSlots,
          missing_slots: missingSlots,
          summary: parsed.current_answer_summary,
        },
        knowledge_level: parsed.staged_writeback?.knowledge_level ?? null,
        asset_level: parsed.staged_writeback?.asset_level ?? null,
        projected_writeback_level: parsed.staged_writeback?.projected_writeback_level ?? projectedWritebackLevel,
      },
      answer_grounding_blocks: (parsed.answer_grounding_blocks ?? []).map((item) => ({
        label: item.label,
        block_type: item.block_type,
        text: item.text,
        refs: item.refs,
        stage: item.stage ?? "",
        step: item.step ?? "",
      })),
      candidate_assets: candidateAssets,
      followup_questions: followupQuestions,
      session_summary: sessionSummary,
      interview_view: interviewView,
      autosave_state: autosaveState,
      degraded_retrieval_mode: degradedRetrievalMode,
      current_trace: toAgentTraceEntity(parsed.current_trace, {
        retrieval: retrievalFallback,
        decision: decisionFallback,
      }),
      turns: (parsed.turns ?? []).map((turn) => ({
        turn_index: turn.turn_index,
        user_input: turn.user_input,
        answer_summary: turn.answer_summary ?? "",
        answer_markdown: turn.answer_markdown ?? "",
        newly_filled_slots: turn.newly_filled_slots ?? [],
        created_at: turn.created_at ?? "",
        agent_trace: toAgentTraceEntity(turn.agent_trace, {
          retrieval: retrievalFallback,
          decision: {
            ...decisionFallback,
            stop_reason: parsed.stop_decision?.reason ?? decisionFallback.stop_reason,
          },
        }),
      })),
      compile_warnings: parsed.compile_warnings ?? [],
      state_path: parsed.state_path ?? "",
    };
  } catch (error) {
    if (error instanceof ZodError) {
      const summary = error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("; ");
      throw new Error(`Extraction interview payload parse failure: ${summary}`);
    }
    throw error;
  }
}
