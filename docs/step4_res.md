Step4 前端工作台已经在隔离 worktree 里实现，位置是 [codex-step4-brain-workbench](/Users/yichen/Desktop/OntologyBrain/LLM-wiki/.worktrees/codex-step4-brain-workbench)。前端应用放在 [brain-workbench](/Users/yichen/Desktop/OntologyBrain/LLM-wiki/.worktrees/codex-step4-brain-workbench/brain-workbench)，核心入口和页面路由在 [src/App.vue](/Users/yichen/Desktop/OntologyBrain/LLM-wiki/.worktrees/codex-step4-brain-workbench/brain-workbench/src/App.vue), [src/app/router/routes.ts](/Users/yichen/Desktop/OntologyBrain/LLM-wiki/.worktrees/codex-step4-brain-workbench/brain-workbench/src/app/router/routes.ts), [src/pages/ask/AskWorkspacePage.vue](/Users/yichen/Desktop/OntologyBrain/LLM-wiki/.worktrees/codex-step4-brain-workbench/brain-workbench/src/pages/ask/AskWorkspacePage.vue)。后端也补了工作台所需的 `/api/*` 薄封装，主要在 [apps/api/server.py](/Users/yichen/Desktop/OntologyBrain/LLM-wiki/.worktrees/codex-step4-brain-workbench/apps/api/server.py) 和 [src/personal_brain/api/workbench_service.py](/Users/yichen/Desktop/OntologyBrain/LLM-wiki/.worktrees/codex-step4-brain-workbench/src/personal_brain/api/workbench_service.py)。

这版已经包含：
- 独立 `brain-workbench/` Vue 3 + TS + Vite + Pinia + Router + Naive UI + ECharts 工作台
- 六个页面：Ask / Writeback / Assets / Profile / Eval / Wiki
- `live first + mock fallback` API client、typed entities、feature composables、Pinia stores、`public/mock` 和 `mock-schemas`
- Python 侧新增 `GET/POST /api/*` 浏览接口，前端可以直接读 ask、writeback、assets、profile、eval、wiki 数据
- `README` 和前端 README 都已补齐

验证结果：
- `npm test` -> `3 passed / 4 tests`
- `npm run build` -> 通过，产出 `brain-workbench/dist`
- `PYTHONPATH=src .venv/bin/pytest -q` -> `26 passed`

还保留了少量明确的 `TODO(BACKEND_ENDPOINT_BINDING)`：
- writeback 的 `reject/edit`
- asset candidate 的 `promote/merge/discard`
- eval 历史报告切换后的细节刷新
这些都保留了 UI，但没有假装已经落库。
