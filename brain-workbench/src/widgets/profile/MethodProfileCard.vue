<template>
  <section class="widget-card">
    <h3>Method Profile</h3>
    <ProfileDimensionList :items="items" />
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { MethodProfileEntity } from "@/entities/method-profile/types";
import ProfileDimensionList from "./ProfileDimensionList.vue";

const props = defineProps<{ profile: MethodProfileEntity }>();
const items = computed(() =>
  Object.entries(props.profile).map(([key, value]) => ({
    key,
    value: Array.isArray(value) ? value.join(", ") : String(value),
  })),
);
</script>
