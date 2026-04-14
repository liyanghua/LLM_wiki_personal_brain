<template>
  <MethodProfileCard :profile="profile" />
</template>

<script setup lang="ts">
import type { MethodProfileEntity } from "@/entities/method-profile/types";
import MethodProfileCard from "@/widgets/profile/MethodProfileCard.vue";

defineProps<{ profile: MethodProfileEntity }>();
</script>
