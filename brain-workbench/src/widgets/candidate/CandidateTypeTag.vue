<template>
  <span class="chip">{{ label }}</span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { CANDIDATE_TYPE_LABELS } from "@/shared/constants/candidateTypes";

const props = defineProps<{ type: string }>();
const label = computed(() => CANDIDATE_TYPE_LABELS[props.type] ?? props.type);
</script>
