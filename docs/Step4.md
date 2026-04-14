Build Phase 4 frontend for the existing Personal Brain OS backend.

## Tech stack
- Vue 3
- TypeScript
- Vite
- Vue Router
- Pinia
- Naive UI
- ECharts for eval charts
- markdown rendering for wiki/proposal previews

## Product goal
This is not a generic chat app.
This is a Brain Workbench frontend for a Personal Brain OS.

The backend already supports:
- wiki-aware query
- structured answers
- session memory
- persistent memory proposals
- writeback routing and merge
- ontology candidates
- skill candidates
- eval reports
- method profile

The frontend should be a thin workbench over that backend.

## Main pages
Build the following pages:

1. Ask Workspace
2. Writeback Review
3. Asset Candidates
4. Profile & Eval
5. Wiki Explorer (recommended)

## Routing
Use routes like:
- /workspace/ask
- /workspace/writeback
- /workspace/assets
- /workspace/profile
- /workspace/eval
- /workspace/wiki

## Page requirements

### 1. Ask Workspace
Layout:
- left sidebar: recent queries / quick topics
- center: question input + structured answer sections
- right sidebar: hit pages / session memory / method mode
- bottom tray: evidence / writeback preview

Answer sections must show:
- Fact
- Synthesis
- Interpretation
- Recommendation
- Citations

### 2. Writeback Review
Show:
- proposal list
- proposal detail
- rationale
- confidence
- supporting pages
- target destination
- merge preview
Actions:
- approve
- reject
- edit

### 3. Asset Candidates
Tabs:
- ontology candidates
- skill candidates
Show:
- candidate list
- detail drawer
- evidence refs
- wiki refs
Actions:
- promote
- merge
- discard

### 4. Profile & Eval
Show:
- method profile
- style/profile proposals
- persistent memory proposals
- eval reports
- metrics chart

### 5. Wiki Explorer
Show:
- page type tree
- page list
- page detail
- linked pages
- backlinks if available

## Architecture requirements
Use a clean modular structure:

src/
- app/
- pages/
- widgets/
- features/
- entities/
- shared/

Do not place all logic inside page components.
Use typed API clients and shared TS models.

## State management
Use Pinia for:
- active query state
- selected proposal
- selected candidate
- profile summary
- eval report selection
- UI layout state

## API layer
Create typed API modules for:
- query
- writeback
- assets
- profile
- eval
- wiki

Use mock adapters or placeholder endpoints if backend endpoints are not fully available yet.
Mark them clearly with TODO(BACKEND_ENDPOINT_BINDING).

## Design principles
- dense but readable workbench UI
- dark-friendly neutral theme
- object-centric, not chat-centric
- keep markdown/wiki as source of truth
- preserve future Hermes runtime integration boundaries

## Deliverables
1. working Vue3 + TS frontend skeleton
2. page routing
3. typed models
4. API client layer
5. page-level mock data
6. reusable widgets for answer, evidence, proposal, candidate, profile, eval
7. TODO markers for backend binding
8. README with run instructions

## Constraints
- do not build a generic chat app
- do not over-optimize visuals before the workbench structure is correct
- do not couple frontend tightly to Hermes runtime internals
- keep the frontend thin and inspectable