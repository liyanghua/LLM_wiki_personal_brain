export const WORKSPACE_ROUTES = {
  ask: "/workspace/ask",
  writeback: "/workspace/writeback",
  assets: "/workspace/assets",
  profile: "/workspace/profile",
  eval: "/workspace/eval",
  wiki: "/workspace/wiki",
} as const;

export const WORKSPACE_NAV = [
  { label: "问题分析", path: WORKSPACE_ROUTES.ask, hint: "基于知识库的深度分析与结论生成" },
  { label: "知识沉淀", path: WORKSPACE_ROUTES.writeback, hint: "审阅可沉淀的高价值解释与决策" },
  { label: "资产候选", path: WORKSPACE_ROUTES.assets, hint: "本体与技能资产的候选管理" },
  { label: "分析画像", path: WORKSPACE_ROUTES.profile, hint: "方法偏好、长期记忆与风格建议" },
  { label: "评估看板", path: WORKSPACE_ROUTES.eval, hint: "资产质量、沉淀精度与方法一致性" },
  { label: "知识地图", path: WORKSPACE_ROUTES.wiki, hint: "知识页面分类浏览与关系探索" },
] as const;
