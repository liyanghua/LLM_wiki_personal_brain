import type { Router } from "vue-router";

export function installRouterGuards(router: Router) {
  router.beforeEach((to, _from, next) => {
    document.title = `${String(to.name ?? "Workbench")} | Brain Workbench`;
    next();
  });
}
