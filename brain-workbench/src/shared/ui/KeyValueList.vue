<template>
  <dl class="key-value-list">
    <template v-for="item in items" :key="item.key">
      <dt>{{ item.key }}</dt>
      <dd>{{ item.value }}</dd>
    </template>
  </dl>
</template>

<script setup lang="ts">
defineProps<{
  items: Array<{ key: string; value: string }>;
}>();
</script>
