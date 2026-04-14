<template>
  <section class="widget-card">
    <h3>Merge Preview</h3>
    <p>{{ contentPreview }}</p>
    <div class="chip-row">
      <ProposalTargetTag :target="target" />
      <span v-for="ref in evidenceRefs" :key="ref" class="chip">{{ ref }}</span>
    </div>
  </section>
</template>

<script setup lang="ts">
import ProposalTargetTag from "./ProposalTargetTag.vue";

defineProps<{ target: string; contentPreview: string; evidenceRefs: string[] }>();
</script>
