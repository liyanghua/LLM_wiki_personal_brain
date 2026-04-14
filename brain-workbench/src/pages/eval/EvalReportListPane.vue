<template>
  <section class="panel-card">
    <h3>Eval Reports</h3>
    <div class="stack">
      <button
        v-for="item in reports"
        :key="item.run_id"
        class="ghost-button"
        @click="$emit('select', item.run_id)"
      >
        {{ item.run_id }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{ reports: Array<Record<string, any>> }>();
defineEmits<{ select: [runId: string] }>();
</script>
