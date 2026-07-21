# CV Tailoring API

API-only Next.js 15 backend: `POST /api/tailor-cv` curates a JD-specific CV JSON from a private master JSON, mechanically renders `.docx`, and returns both artifacts.

## Overview

- **What it does:** Master JSON → curator LLM → schema validate → mechanical `.docx`; returns base64 Word + curated JSON + builder version.
- **Who calls it:** CCC backend (Bearer secret, server-side) and the smoke CLI. Seekers never hold the key.
- **No frontend, no database** (stateless). Auth = shared secret (`TAILOR_API_KEY`).

---

## Prerequisites

- Node.js ≥ 22.0.0
- npm
- At least one LLM API key for the configured `TAILOR_MODEL` provider
- `TAILOR_API_KEY`, plus `MASTER_CV_JSON` or `MASTER_CV_PATH`
- `TAILOR_MODEL` as namespaced `provider/model` (e.g. `anthropic/sonnet`)

---

## Local Setup

```bash
cp .env.example .env.local
# Fill TAILOR_API_KEY, MASTER_CV_*, TAILOR_MODEL, LLM keys, Upstash Redis
npm install
npm run dev
curl http://localhost:3000/api/hello
```

Smoke reads dotenv (prefer `.env` / env already loaded): `npm run smoke -- http://localhost:3000`

---

## Environment Variables

Full catalog: [`.env.example`](.env.example)

| Variable | Purpose | Default |
|----------|---------|---------|
| `TAILOR_API_KEY` | Bearer shared secret | — |
| `MASTER_CV_JSON` / `MASTER_CV_PATH` | Canonical master CV | — |
| `TAILOR_MODEL` | Curator model | `anthropic/sonnet` |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_SECRET_MAX` | Dual rate ceilings | `5` / half |
| `LANGFUSE_TRACING` | Langfuse tracing | `false` |

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/hello` | Health probe |
| `POST` | `/api/tailor-cv` | Bearer + JD → `{ cv, curatedJson, builderVersion, model, usage, remaining, resetTime }` |

Full reference: [`docs/api/API.md`](docs/api/API.md)

---

## Quick Examples

```bash
curl http://localhost:3000/api/hello

curl -s -X POST http://localhost:3000/api/tailor-cv \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TAILOR_API_KEY" \
  -d '{"jobDescription": "Senior React engineer. Requirements: TypeScript, React, Node."}' \
  | jq -r '.cv' | base64 -d > /tmp/cv.docx
```

---

## Testing

```bash
npm test                 # unit — no live tailor/smoke LLM
npm run smoke -- http://localhost:3000   # manual live API + judges (not CI)
npm run regen-docx -- curated.json out.docx --builder-version=1.0.0
npm run test:e2e         # Playwright HTTP checks (Bearer required)
```

`scripts/eval-cv.ts` markdown generation eval is **retired** — use smoke for live quality.

See [`docs/test/TESTING.md`](docs/test/TESTING.md).

---

## Deployment (Railway)

- Config: [`railway.toml`](railway.toml), [`.env.example`](.env.example).
- Set `TAILOR_API_KEY`, master CV secret, Redis, LLM keys; rotate the shared secret if leaked (coordinate with CCC).
- When leaving local-only: CCC must send `Authorization: Bearer` in the same window as this cutover.

---

## Architecture

| Doc | Purpose |
|-----|---------|
| [`docs/arch/README.md`](docs/arch/README.md) | Stack decisions |
| [`docs/arch/APP_WALKTHROUGH.md`](docs/arch/APP_WALKTHROUGH.md) | Request flow |
| [`docs/arch/FILE_LAYOUT.md`](docs/arch/FILE_LAYOUT.md) | Project tree |
| [`docs/api/API.md`](docs/api/API.md) | API reference |
| [`docs/test/TESTING.md`](docs/test/TESTING.md) | Test strategy |
| [`CONCEPTS.md`](CONCEPTS.md) | Domain vocabulary |
