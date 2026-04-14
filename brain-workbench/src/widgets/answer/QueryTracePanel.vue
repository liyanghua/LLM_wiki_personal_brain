<template>
  <section class="widget-card">
    <h3>Query Trace</h3>
    <p>{{ questionType }}</p>
    <div class="chip-row">
      <span v-for="cue in cues" :key="cue" class="chip">{{ cue }}</span>
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{ questionType: string; cues: string[] }>();
</script>
