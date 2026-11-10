# Local mocks

Bring CCC up without live DeepSeek, Upstash, or Gmail.

```bash
cp .env.example .env.local
# paste overlay from env.backend.example
# set TAILOR_API_KEY; copy the sample master CV:
mkdir -p secrets
cp references/json-curator/master-cv.schema-sample.json secrets/master_cv.json
chmod 600 secrets/master_cv.json

npm install
npm run dev:local          # mocks on :8079/:4010, API on :3001
# exits if those URLs are not the loopback mock ports, or TAILOR_MODEL is not deepseek/
```

Inbox worker without live Gmail (HTTPS Gmail URLs stay; fetch is injected):

```bash
npm run inbox:scan:local
```

Frontend: see `env.frontend.example` and `docs/test/local-dev.md`.

Blank Redis, DeepSeek, and `TAILOR_MODEL` values are filled with the local mock defaults before the loopback check. `INBOX_SCAN_LOCAL_REDIS_PROBE=1` exercises `getRedisKey` / `setRedisKey` / `evalRedisScript` after the scan.
