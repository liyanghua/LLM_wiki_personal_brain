# Brain Workbench

Step4 frontend workbench for the Personal Brain OS backend.

## Stack

- Vue 3
- TypeScript
- Vite
- Vue Router
- Pinia
- Naive UI
- ECharts
- markdown-it + DOMPurify

## Scripts

```bash
npm install
npm run dev
npm run test
npm run build
```

## Modes

Create `.env` from `.env.example`:

```bash
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_DATA_MODE=live
```

- `live`: call Python `/api/*` endpoints first, then fall back to mock payloads if the endpoint is unavailable.
- `mock`: always use local mock payloads in `src/mocks/`.

## Backend Binding

The current frontend is intentionally thin.

- `POST /api/ask` is fully wired.
- Workbench browsing endpoints are file-backed thin wrappers over the existing Python services.
- destructive or promotion-style actions remain review-only and are marked with `TODO(BACKEND_ENDPOINT_BINDING)` where the backend workflow is intentionally deferred.

## Pages

- `/workspace/ask`
- `/workspace/writeback`
- `/workspace/assets`
- `/workspace/profile`
- `/workspace/eval`
- `/workspace/wiki`

## Mock Assets

- payload examples live in `public/mock/`
- TS mock objects live in `src/mocks/`
- schema-like contracts live in `mock-schemas/`
