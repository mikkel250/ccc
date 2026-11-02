# Local mock stack

Stand-ins under `dev/` so tailor, rate-limit, and inbox scan can run without live DeepSeek, Upstash, or Gmail.

## One-command API

```bash
# .env.local from .env.example + dev/env.backend.example
npm run dev:local
```

Loads `.env.local` when that file exists, otherwise `.env`, into the mock process. Variables already set in the shell take precedence. Then it starts the Upstash REST mock (`:8079`), the DeepSeek mock (`:4010`), and `next dev` on `PORT` (default **3001**). Frontend stays on **3000**.

Inbox without live Gmail (injected `fetchImpl`; `GMAIL_*_URL` remain HTTPS):

```bash
npm run inbox:scan:local
```

That scan talks to the Upstash mock and, when CCC PR #66 is present, exercises `getRedisKey` / `setRedisKey` / `evalRedisScript`.

## Frontend

`ccc-frontend` is a separate repo. Overlay: `dev/env.frontend.example`. Postgres via `docker compose up -d` or a local 16 cluster. Then `npx prisma migrate deploy && npm run dev`.

## Production-like credentials still required

- Real LLM key for the configured `TAILOR_MODEL` (DeepSeek mock is connectivity-only)
- Real Upstash REST URL + token
- Real `MASTER_CV_JSON` / `MASTER_CV_PATH` (career PII)
- Real Gmail OAuth (`GMAIL_CLIENT_*`, `GMAIL_REFRESH_TOKEN`) for live `inbox:scan`
