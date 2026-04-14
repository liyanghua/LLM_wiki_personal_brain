<template>
  <StatusBadge :label="status" :tone="tone" />
</template>

<script setup lang="ts">
import { computed } from "vue";
import StatusBadge from "@/shared/ui/StatusBadge.vue";

const props = defineProps<{ status: string }>();
const tone = computed(() => (props.status.includes("approved") ? "success" : "warning"));
</script>
