# GitHub Copilot Instructions for Online Notes Platform

## Project Context
This is a full-stack knowledge management platform featuring real-time collaboration.
- **Frontend**: Next.js 14 (App Router), TypeScript, Tailwind CSS, Tiptap (Editor), Yjs (Collaboration).
- **Backend**: NestJS, TypeScript, MongoDB (Mongoose), Redis, WebSockets.
- **Infrastructure**: Docker, PM2, Systemd.

## Architecture & Patterns

### Frontend (`notes-frontend`)
- **App Router**: Use `src/app` for routes. Follow Next.js 14 conventions (Server Components by default).
- **State Management**: Use React Hooks for local state. Use Yjs providers for collaborative state.
- **Editor**: Tiptap is the core editor. Custom extensions are in `src/components/editor`.
- **Styling**: Tailwind CSS. Use `src/app/globals.css` for global styles.

### Backend (`notes-backend`)
- **Modular Architecture**: Features are organized in `src/modules/` (e.g., `auth`, `notes`, `users`).
- **API Standards**:
  - **Response Format**: Always use the unified envelope: `{ code, message, data, requestId, timestamp }`.
  - **Timeout**: APIs have a default 3s timeout.
  - **Idempotency**: Support `Idempotency-Key` header for write operations.
  - **Definition**: Refer to `openapi.yaml` for the contract.
- **Database**: Mongoose for MongoDB interactions.

### Collaboration (`y-websocket`)
- Separate service for handling real-time updates via WebSockets.

## Development Workflow

### Build & Run
- **Frontend**: `cd notes-frontend && npm run dev` (Port 3000)
- **Backend**: `cd notes-backend && npm run dev` (Port 3001)
- **Pre-deploy Check**: Run `scripts/predeploy-check.ps1` to validate builds and types before committing.

### Testing
- **Frontend**: Jest tests in `__tests__/`. Run with `npm run ci:test`.
- **API Testing**: Use JSON files in `api-test/` as templates for manual testing or integration tests.

## Coding Conventions
- **TypeScript**: Strict mode enabled. Avoid `any`. Use defined interfaces in `types/` or DTOs.
- **Error Handling**: Use standard error codes defined in `openapi.yaml`.
- **Comments**: Document complex logic, especially in the collaboration engine and custom editor extensions.

## Key Files
- **API Contract**: `notes-backend/openapi.yaml`
- **Backend Entry**: `notes-backend/src/main.ts`
- **Frontend Layout**: `notes-frontend/src/app/layout.tsx`
- **Deployment**: `DEPLOYMENT.md`
