# CV Tailoring API

API-only Next.js backend: `POST /api/tailor-cv` accepts a job description and returns a tailored CV as a base64-encoded `.docx`, generated via LLM against the `knowledge-base/` markdown files.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/hello` | Health check |
| POST | `/api/tailor-cv` | `{ "jobDescription": "...", "sessionId": "optional" }` → `{ "cv": "<base64>" }` |

## Local development (start here)

```bash
cp .env.example .env.local
# Fill in API keys (at least one LLM provider + TAILOR_MODEL)
npm install
npm run dev
```

Health check: `curl http://localhost:3000/api/hello`

Tailor a CV (requires keys in `.env.local`):

```bash
curl -X POST http://localhost:3000/api/tailor-cv \
  -H "Content-Type: application/json" \
  -d '{"jobDescription": "Senior React engineer. Requirements: TypeScript, React."}'
```

Full e2e (3 sample JDs) with the dev server running:

```bash
npx tsx scripts/e2e-tailor-cv.ts http://localhost:3000
```

## Tests

See **[docs/workingDocs/TESTING.md](docs/workingDocs/TESTING.md)** for local dev setup, unit tests, e2e commands, and quota troubleshooting.

```bash
npm test
```

## Railway deployment (deferred)

Deploy only when local validation is done — Railway bills on usage/traffic. Config is ready when you need it: [`railway.toml`](railway.toml) and [`.env.example`](.env.example). Steps: push to GitHub → Railway **Deploy from GitHub** → copy env vars → verify `GET /api/hello`.

## Stack

See [`docs/arch/README.md`](docs/arch/README.md).
