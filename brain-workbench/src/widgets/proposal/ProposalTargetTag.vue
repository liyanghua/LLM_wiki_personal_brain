<template>
  <span class="chip">{{ label }}</span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { PROPOSAL_TARGET_LABELS } from "@/shared/constants/proposalTargets";

const props = defineProps<{ target: string }>();
const label = computed(() =>
  Object.entries(PROPOSAL_TARGET_LABELS).find(([prefix]) => props.target.startsWith(prefix))?.[1] ?? props.target,
);
</script>
