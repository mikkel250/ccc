# Local mock stack

Stand-ins under `dev/` so tailor, rate-limit, and inbox scan can run without live DeepSeek, Upstash, or Gmail.

## One-command API

```bash
# .env.local from .env.example + dev/env.backend.example
npm run dev:local
```

Loads `.env.local` when that file exists, otherwise `.env`, into the shell before the mocks and `next dev` start. Variables already set in the shell take precedence. `UPSTASH_REDIS_REST_URL` and `DEEPSEEK_BASE_URL` must be `http://127.0.0.1` or `http://localhost` on the mock ports (`8079` and `4010` unless `UPSTASH_REST_PORT` / `DEEPSEEK_MOCK_PORT` say otherwise). A live URL, including one already exported in the shell, makes `dev:local` exit before the mocks start. Then it starts the Upstash REST mock, the DeepSeek mock, and `next dev` on `PORT` (default **3001**). If either mock or Next.js exits, the rest of the stack is stopped. Frontend stays on **3000**.

Inbox without live Gmail (injected `fetchImpl`; `GMAIL_*_URL` remain HTTPS):

```bash
npm run inbox:scan:local
```

That scan refuses a non-loopback `UPSTASH_REDIS_REST_URL` or `DEEPSEEK_BASE_URL` before it reads mail. It talks to the Upstash mock and, when CCC PR #66 is present, exercises `getRedisKey` / `setRedisKey` / `evalRedisScript`. The process exits 1 when any item is `fetch-failed`, `tailor-failed`, or `draft-failed`.

## Frontend

`ccc-frontend` is a separate repo. Overlay: `dev/env.frontend.example`. Postgres via `docker compose up -d` or a local 16 cluster. Then `npx prisma migrate deploy && npm run dev`.

## Still required outside the mocks

- `MASTER_CV_JSON` / `MASTER_CV_PATH` (career PII). The DeepSeek mock is connectivity-only and accepts `DEEPSEEK_API_KEY=local-dev-deepseek-key`.
- Real Gmail OAuth (`GMAIL_CLIENT_*`, `GMAIL_REFRESH_TOKEN`) for live `inbox:scan` only. `inbox:scan:local` does not call Gmail.
- A real Upstash URL is for live `inbox:scan` and production rate limits. `dev:local` and `inbox:scan:local` exit when that URL is not loopback.
