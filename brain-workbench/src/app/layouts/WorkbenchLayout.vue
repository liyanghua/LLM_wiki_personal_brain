<template>
  <n-config-provider :theme="darkTheme" :theme-overrides="themeOverrides">
    <div class="app-shell">
      <aside class="app-shell__nav">
        <div class="app-shell__brand">
          <p class="eyebrow">Personal Brain OS</p>
          <h1>{{ appMeta.title }}</h1>
          <p>{{ appMeta.subtitle }}</p>
          <small>{{ dataStatusLabel }}</small>
        </div>
        <nav class="nav-list">
          <RouterLink v-for="item in WORKSPACE_NAV" :key="item.path" :to="item.path" class="nav-link">
            <strong>{{ item.label }}</strong>
            <p>{{ item.hint }}</p>
          </RouterLink>
        </nav>
      </aside>
      <main class="app-shell__main">
        <slot />
      </main>
    </div>
  </n-config-provider>
</template>

<script setup lang="ts">
import { NConfigProvider, darkTheme } from "naive-ui";
import { RouterLink } from "vue-router";
import { appMeta } from "@/app/providers/app-provider";
import { dataStatusLabel } from "@/app/providers/mock-provider";
import { themeOverrides } from "@/app/providers/theme-provider";
import { WORKSPACE_NAV } from "@/shared/constants/routes";
</script>
