import { computed, onMounted } from "vue";
import { storeToRefs } from "pinia";
import { useQueryStore } from "@/app/stores/query.store";
import { useUiStore } from "@/app/stores/ui.store";
import { answerSectionsFromMarkdown } from "./mapper";
import { askQuestion } from "./api";
import { resolvePinia } from "@/shared/lib/guards";
import { loadRecentMemory } from "@/features/memory/api";

export function useAskWorkspace() {
  const pinia = resolvePinia();
  const queryStore = useQueryStore(pinia);
  const uiStore = useUiStore(pinia);
  const { currentQuestion, result, recentMemory, loading } = storeToRefs(queryStore);

  const sections = computed(() => answerSectionsFromMarkdown(result.value));

  async function submit(question = currentQuestion.value) {
    queryStore.loading = true;
    queryStore.currentQuestion = question;
    queryStore.result = await askQuestion(question);
    queryStore.loading = false;
  }

  onMounted(async () => {
    queryStore.recentMemory = await loadRecentMemory();
  });

  return {
    currentQuestion,
    result,
    recentMemory,
    sections,
    loading,
    bottomTrayTab: computed(() => uiStore.bottomTrayTab),
    submit,
  };
}
