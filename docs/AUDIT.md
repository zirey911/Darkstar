# Repository audit — 2026-11-04

> Historical snapshot before terrain implementation. See [TERRAIN.md](TERRAIN.md)
> for the subsequently implemented map, numerical MOLA processing and routing.

Scope: tracked source, documentation, CI and the chat changes in this working tree.
This is an implementation audit, not confirmation of competition eligibility.

## Implemented

- `apps/web/app/page.tsx`, `globals.css`: responsive chat layout, suggestions,
  in-page transcript, pending/error states, retry/edit and new chat.
- `apps/web/app/api/chat/route.ts`: same-origin server proxy to Python, timeout,
  no-store responses and user-facing failure handling.
- `services/navigation/src/darkstar_navigation/chat.py`: real configurable HTTPS
  Chat Completions provider requests, server-only credentials, bounded/validated
  history and Mars science/assumption/speculation instructions. No fabricated fallback.
- `main.py`: health and chat endpoints, FastAPI OpenAPI documentation.
- Existing workspace, Python package, test/lint tooling and CI workflow.

## Incomplete

- AI chat is implemented but needs credentialed live verification and scientific
  answer review. Prompt instructions cannot guarantee factuality or citations.
- `docs/DATA_SOURCES.md` lists candidate archives only; no selected products,
  ingestion pipeline, provenance records or actual data-backed decisions exist.
- `docs/PROJECT_BRIEF.md` describes candidate capabilities; `docs/DECISIONS.md`
  explicitly leaves exact challenge brief and deliverables unresolved.
- `packages/shared/README.md` is a placeholder, not a runtime integration.

## Missing for the documented project concept

- Georeferenced imagery/elevation viewer for a selected Mars region.
- Terrain ingestion, coordinate/unit validation and nodata handling.
- Start/end selection, terrain-aware routing, elevation profiles and route comparison.
- Auditable route assumptions, scientific validation and source attribution in the UI.
- Curated, source-grounded survival content or retrieval supporting AI answers.
- A submission narrative/demo and confirmed deliverables checklist.

Resource estimates and simulated hazards are explicitly optional in the project brief;
do not treat them as official requirements. Persistent chat storage is not necessary
for the current local prototype. No official challenge page or full requirements are
stored in the repository, so compliance and mandatory feature completeness are unknown.

## Blockers

- No `LLM_API_KEY` or `OPENAI_API_KEY` was available in this session; a live model
  answer and provider account access/billing could not be verified.
- The core mapped expedition-planning experience has not been implemented.
- Exact competition rules, challenge scope and submission requirements need confirmation.
- Public exposure needs access/request/cost controls; current endpoints have no auth
  or rate limiting. No hosting configuration is supplied.
- Local Node is 26.5.0, outside the repository's Node 24.x baseline.

## Prioritized next steps

1. Configure a backend provider key/model; verify a real question, contextual
   follow-up, failed request/retry and science-vs-speculation behavior.
2. Obtain the official challenge URL/brief and rules; turn required outputs into an
   acceptance checklist. Confirm whether pre-event implementation is eligible.
3. Select one Mars region and imagery/elevation products. Record source, attribution,
   checksum, coverage, resolution, reference body, coordinate conventions and units.
4. Implement validated ingestion and an interactive regional map with source details,
   start/end selection and explicit missing-data boundaries.
5. Implement terrain-aware routing and elevation profiles; document slope/cost
   assumptions and validate known cases, boundaries and unreachable destinations.
6. Add route comparison and source-backed survival explanations. Connect chat to
   verified region/route context only after that data and computation exist.
7. Build resource/hazard estimates only if confirmed scope warrants them, exposing
   inputs, units and uncertainty. Never label simulations as live conditions.
8. Verify the complete demo on Node 24/Python 3.12, add hosting access/cost controls
   if public, and prepare the confirmed submission assets with NASA data attribution.

## User actions

Supply the provider credential securely in the backend environment (not chat or Git),
confirm provider access/billing, provide the official challenge/rules link, choose or
approve the target region, and select hosting only when ready for a public demo.
See `CHAT.md` for exact environment variables and launch instructions.

## Verification

- Frontend: 4 tests passed (conversation history, loading, retry, proxy and outage).
- Backend: 13 tests passed (including health, provider contract, input validation,
  missing credentials and sanitized failures).
- TypeScript, ESLint, Ruff and `git diff --check` passed.
- Provider tests use explicit fixtures; no live LLM/scientific validation was performed.
- Existing Starlette/HTTPX deprecation warning remains; no dependency changes added.
- Default Turbopack production build failed on worker port permissions in this local
  environment, including the escalated retry. Production build passed with
  `npm run build --workspace @darkstar/web -- --webpack`.
- Browser visual inspection was not performed; responsive layout is implemented in CSS.

No commit, push or deployment was performed.
