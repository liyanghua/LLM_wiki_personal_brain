import { computed, onMounted } from "vue";
import { storeToRefs } from "pinia";
import type { AskMode } from "@/app/stores/query.store";
import type { ExtractionInterviewStateEntity } from "@/entities/extraction-interview/types";
import { useQueryStore } from "@/app/stores/query.store";
import { useUiStore } from "@/app/stores/ui.store";
import { answerSectionsFromMarkdown } from "./mapper";
import {
  askQuestion,
  continueExtractionInterview,
  finishExtractionInterview,
  getExtractionInterview,
  startExtractionInterview,
} from "./api";
import { resolvePinia } from "@/shared/lib/guards";
import { loadRecentMemory } from "@/features/memory/api";

function readUrlState(): { mode: AskMode; interviewId: string | null } {
  if (typeof window === "undefined") {
    return { mode: "extraction", interviewId: null };
  }

  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode") === "quick" ? "quick" : "extraction";
  const interviewId = mode === "extraction" ? params.get("interview_id") : null;
  return { mode, interviewId };
}

export function useAskWorkspace() {
  const pinia = resolvePinia();
  const queryStore = useQueryStore(pinia);
  const uiStore = useUiStore(pinia);
  const {
    mode,
    questionDraft,
    quickResult,
    extractionState,
    recentMemory,
    loading,
    error,
    followupAnswerDraft,
    selectedCandidateQuestion,
  } = storeToRefs(queryStore);

  const quickSections = computed(() => answerSectionsFromMarkdown(quickResult.value));
  const extractionSections = computed(() =>
    answerSectionsFromMarkdown(extractionState.value?.current_answer_markdown ?? ""),
  );

  const currentQuestionType = computed(() =>
    mode.value === "quick"
      ? quickResult.value.question_classification.question_type
      : extractionState.value?.question_type ?? "",
  );

  const currentCues = computed(() =>
    mode.value === "quick" ? quickResult.value.question_classification.cues : [],
  );

  function syncUrl(nextMode = mode.value, interviewId?: string | null) {
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);
    url.searchParams.set("mode", nextMode);

    if (nextMode === "extraction" && interviewId) {
      url.searchParams.set("interview_id", interviewId);
    } else {
      url.searchParams.delete("interview_id");
    }

    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function applyExtractionState(nextState: ExtractionInterviewStateEntity) {
    queryStore.extractionState = nextState;
    const candidates = nextState.next_question_plan.candidate_questions;

    if (candidates.length === 0) {
      queryStore.selectedCandidateQuestion = "";
      return;
    }

    if (!candidates.includes(queryStore.selectedCandidateQuestion)) {
      queryStore.selectedCandidateQuestion = candidates[0];
    }
  }

  async function runRequest(task: () => Promise<void>, fallbackMessage: string) {
    queryStore.loading = true;
    queryStore.error = "";
    try {
      await task();
    } catch (e: any) {
      queryStore.error = e?.message || fallbackMessage;
    } finally {
      queryStore.loading = false;
    }
  }

  async function hydrateFromUrl() {
    const { mode: nextMode, interviewId } = readUrlState();
    queryStore.mode = nextMode;

    if (nextMode === "extraction" && interviewId) {
      await runRequest(async () => {
        const restored = await getExtractionInterview(interviewId);
        applyExtractionState(restored);
        syncUrl("extraction", restored.interview_id);
      }, "恢复采掘会话失败");
      return;
    }

    syncUrl(nextMode, nextMode === "extraction" ? queryStore.extractionState?.interview_id : null);
  }

  async function submitQuick(question = questionDraft.value) {
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion) {
      queryStore.error = "请输入问题";
      return;
    }

    queryStore.mode = "quick";
    queryStore.questionDraft = normalizedQuestion;

    await runRequest(async () => {
      queryStore.quickResult = await askQuestion(normalizedQuestion);
      syncUrl("quick");
    }, "分析请求失败");
  }

  async function startExtraction(question = questionDraft.value) {
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion) {
      queryStore.error = "请输入问题";
      return;
    }

    queryStore.mode = "extraction";
    queryStore.questionDraft = normalizedQuestion;

    await runRequest(async () => {
      const started = await startExtractionInterview(normalizedQuestion);
      applyExtractionState(started);
      queryStore.followupAnswerDraft = "";
      syncUrl("extraction", started.interview_id);
    }, "开始采掘失败");
  }

  async function continueExtraction(answer = followupAnswerDraft.value) {
    const interviewId = extractionState.value?.interview_id;
    const normalizedAnswer = answer.trim();

    if (!interviewId) {
      queryStore.error = "请先开始采掘";
      return;
    }

    if (!normalizedAnswer) {
      queryStore.error = "请输入补充回答";
      return;
    }

    queryStore.followupAnswerDraft = normalizedAnswer;

    await runRequest(async () => {
      const continued = await continueExtractionInterview(interviewId, normalizedAnswer);
      applyExtractionState(continued);
      queryStore.followupAnswerDraft = "";
      syncUrl("extraction", interviewId);
    }, "继续采掘失败");
  }

  async function finishExtraction() {
    const interviewId = extractionState.value?.interview_id;
    if (!interviewId) {
      queryStore.error = "请先开始采掘";
      return;
    }

    await runRequest(async () => {
      const finished = await finishExtractionInterview(interviewId);
      applyExtractionState(finished);
      syncUrl("extraction", interviewId);
    }, "结束采掘失败");
  }

  function switchMode(nextMode: AskMode) {
    queryStore.mode = nextMode;
    queryStore.error = "";
    syncUrl(nextMode, nextMode === "extraction" ? queryStore.extractionState?.interview_id : null);
  }

  function resetExtraction() {
    queryStore.mode = "extraction";
    queryStore.extractionState = null;
    queryStore.followupAnswerDraft = "";
    queryStore.selectedCandidateQuestion = "";
    queryStore.error = "";
    syncUrl("extraction");
  }

  function selectCandidateQuestion(question: string) {
    queryStore.selectedCandidateQuestion = question;
  }

  onMounted(async () => {
    await hydrateFromUrl();
    try {
      queryStore.recentMemory = await loadRecentMemory();
    } catch {
      // recent memory is non-critical
    }
  });

  return {
    mode,
    questionDraft,
    quickResult,
    extractionState,
    recentMemory,
    quickSections,
    extractionSections,
    loading,
    error,
    followupAnswerDraft,
    selectedCandidateQuestion,
    bottomTrayTab: computed(() => uiStore.bottomTrayTab),
    currentQuestionType,
    currentCues,
    submitQuick,
    startExtraction,
    continueExtraction,
    finishExtraction,
    switchMode,
    resetExtraction,
    selectCandidateQuestion,
  };
}
