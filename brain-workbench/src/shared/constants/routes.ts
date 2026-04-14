export const WORKSPACE_ROUTES = {
  ask: "/workspace/ask",
  writeback: "/workspace/writeback",
  assets: "/workspace/assets",
  profile: "/workspace/profile",
  eval: "/workspace/eval",
  wiki: "/workspace/wiki",
} as const;

export const WORKSPACE_NAV = [
  { label: "Ask", path: WORKSPACE_ROUTES.ask, hint: "查询与答案工作区" },
  { label: "Writeback", path: WORKSPACE_ROUTES.writeback, hint: "写回提案审阅" },
  { label: "Assets", path: WORKSPACE_ROUTES.assets, hint: "Ontology / Skill 候选" },
  { label: "Profile", path: WORKSPACE_ROUTES.profile, hint: "方法画像与记忆提案" },
  { label: "Eval", path: WORKSPACE_ROUTES.eval, hint: "评估报告与趋势" },
  { label: "Wiki", path: WORKSPACE_ROUTES.wiki, hint: "Wiki 浏览与关系探索" },
] as const;
