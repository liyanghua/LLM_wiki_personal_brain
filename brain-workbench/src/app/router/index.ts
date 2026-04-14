import { createRouter, createWebHistory } from "vue-router";
import { routes } from "./routes";
import { installRouterGuards } from "./guards";

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

installRouterGuards(router);
