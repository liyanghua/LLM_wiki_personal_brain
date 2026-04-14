

# 七、 mock schema 设计 Prompt


```text id="hovd3e"
Design the frontend mock schema system for the Vue3 + TypeScript Brain Workbench.

## Goal
The frontend must be built mock-first but remain aligned with the future backend API.
Mock data must represent the real domain objects of the Personal Brain OS, not generic placeholder UI data.

## Requirements

### 1. Create a dedicated mock schema layer
Use:
- `mock-schemas/` for JSON schema files
- `src/mocks/` for TS mock data providers
- `entities/*/types.ts` for domain TS types
- `entities/*/schema.ts` for runtime validation schemas
- `entities/*/adapters.ts` for converting backend-like objects into view models

### 2. Implement mock schemas for these objects
- query response
- writeback proposal
- ontology candidate
- skill candidate
- method profile
- eval report
- wiki page

### 3. Each mock object should support:
- list view
- detail view
- status transitions if relevant
- future backend compatibility

### 4. The schema design must reflect the existing backend concepts:
- structured answer sections
- retrieved pages
- evidence snippets
- writeback target and rationale
- ontology candidate evidence chain
- skill candidate packaging
- method profile dimensions
- eval metric summary and trend
- wiki page links and backlinks

### 5. Add mappers
For each domain object:
- create a mapper from raw mock/backend payload to the UI-facing view model
- keep UI components decoupled from backend payload shape

### 6. Add mock API adapters
Implement a mock client layer that returns Promise-based results so page logic can be swapped to real API endpoints later with minimal changes.

### 7. Add TODO markers
Use:
- TODO(BACKEND_ENDPOINT_BINDING)
- TODO(HERMES_RUNTIME_INTEGRATION)
where appropriate.

## Deliverables
1. mock schema files
2. TS domain types
3. runtime schema validators
4. mock TS payloads
5. adapter/mappers
6. mock API client
7. sample data for all main pages
```

