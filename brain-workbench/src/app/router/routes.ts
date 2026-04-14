import type { RouteRecordRaw } from "vue-router";
import { WORKSPACE_ROUTES } from "@/shared/constants/routes";

export const routes: RouteRecordRaw[] = [
  {
    path: "/",
    redirect: WORKSPACE_ROUTES.ask,
  },
  {
    path: WORKSPACE_ROUTES.ask,
    name: "AskWorkspace",
    component: () => import("@/pages/ask/AskWorkspacePage.vue"),
  },
  {
    path: WORKSPACE_ROUTES.writeback,
    name: "WritebackReview",
    component: () => import("@/pages/writeback/WritebackReviewPage.vue"),
  },
  {
    path: WORKSPACE_ROUTES.assets,
    name: "AssetCandidates",
    component: () => import("@/pages/assets/AssetCandidatesPage.vue"),
  },
  {
    path: WORKSPACE_ROUTES.profile,
    name: "ProfileWorkspace",
    component: () => import("@/pages/profile/ProfileWorkspacePage.vue"),
  },
  {
    path: WORKSPACE_ROUTES.eval,
    name: "EvalReports",
    component: () => import("@/pages/eval/EvalReportsPage.vue"),
  },
  {
    path: WORKSPACE_ROUTES.wiki,
    name: "WikiExplorer",
    component: () => import("@/pages/wiki/WikiExplorerPage.vue"),
  },
];
