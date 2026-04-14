<template>
  <section class="widget-card">
    <h3>Evidence Refs</h3>
    <div class="chip-row">
      <span v-for="item in evidenceRefs" :key="item" class="chip">{{ item }}</span>
    </div>
    <h3>Wiki Refs</h3>
    <div class="chip-row">
      <span v-for="item in wikiRefs" :key="item" class="chip">{{ item }}</span>
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{ evidenceRefs: string[]; wikiRefs: string[] }>();
</script>
