# 八、“前端目录结构 + 命名” Prompt

Build the frontend folder structure and naming conventions for a Vue 3 + TypeScript Brain Workbench.

## Tech stack
- Vue 3
- TypeScript
- Vite
- Vue Router
- Pinia
- Naive UI

## Folder design principles
- page-level containers go in `pages/`
- reusable business widgets go in `widgets/`
- business logic and api bindings go in `features/`
- stable domain object definitions go in `entities/`
- app shell, router, stores, and layouts go in `app/`
- shared utilities and UI primitives go in `shared/`
- mock payloads go in `src/mocks/`
- JSON schema-like files go in `mock-schemas/`

## Naming rules
- route pages must end with `Page.vue`
- split panes should end with `Pane.vue`
- standalone business panels should end with `Panel.vue`
- drawers should end with `Drawer.vue`
- composables should start with `use`
- stores should end with `.store.ts`
- domain object folders should contain `types.ts`, `schema.ts`, `adapters.ts`

## Required pages
- AskWorkspacePage.vue
- WritebackReviewPage.vue
- AssetCandidatesPage.vue
- ProfileWorkspacePage.vue
- EvalReportsPage.vue
- WikiExplorerPage.vue

## Required outputs
1. actual folder scaffold
2. placeholder files with correct naming
3. page-level imports wired to router
4. typed mock-first feature modules
5. TODO markers for backend endpoint binding
