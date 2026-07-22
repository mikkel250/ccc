# CV Tailoring API Reference

`POST /api/tailor-cv` accepts a job description, curates a structured CV JSON from a master JSON, mechanically renders `.docx`, and returns both artifacts. Base URL: `http://localhost:3000` in dev; Railway URL in production.

---

## Authentication

Required: `Authorization: Bearer <TAILOR_API_KEY>`.

| Presenter | Notes |
|-----------|--------|
| Smoke CLI (`npm run smoke`) | Operator / manual live-API path |
| CCC backend | Product traffic (server-side only; never browser/mobile) |

Missing/invalid Bearer → **401**. Unset/`TAILOR_API_KEY` misconfiguration, production bypass hard-block, or other auth-gate unavailability → **503** (fail closed; not all auth failures are 401). Deployed environments fail closed when `TAILOR_API_KEY` is unset. Local insecure bypass (`TAILOR_AUTH_INSECURE_BYPASS=1`) is hard-blocked when production markers are set.

**Rotation (R21a):** If the key may have leaked, replace `TAILOR_API_KEY` in the API deploy and in CCC at the same time; old Bearer tokens stop working immediately.

**Consumer cutover:** When leaving local-only, CCC must present Bearer in the same release window as this API — there is no soft unauthenticated path.

---

## Rate Limiting

Dual Upstash sliding-window ceilings (R21):

| Bucket | Env var | Default |
|--------|---------|---------|
| Per client IP | `RATE_LIMIT_MAX` | `5` |
| Per shared-secret hash | `RATE_LIMIT_SECRET_MAX` | `floor(RATE_LIMIT_MAX / 2)` (min 1) |
| Window | `RATE_LIMIT_WINDOW` | `60000` ms |

Success responses return the **more restrictive** `remaining` / `resetTime` of the two buckets. `sessionId` does not key rate limits.

```json
HTTP 429
{
  "error": "Too many requests. Please wait before trying again.",
  "remaining": 0,
  "resetTime": 1717632000000
}
```

---

## `GET /api/hello`

Health probe. No LLM call, no master CV access.

**Response 200:**
```json
{ "service": "cv-tailoring-api", "status": "ok" }
```

---

## `POST /api/tailor-cv`

Loads master CV (`MASTER_CV_JSON` or `MASTER_CV_PATH`), runs the JSON curator LLM, schema-validates curated JSON, builds `.docx`, returns dual artifacts.

### Request

Headers: `Content-Type: application/json`, `Authorization: Bearer <TAILOR_API_KEY>`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `jobDescription` | `string` | Yes | Untrusted JD text; size capped by `TAILOR_JD_MAX_CHARS` (default 50000) |
| `sessionId` | `string` | No | Optional caller ID (not used for rate limiting) |
| `curationMode` | `"strict"` \| `"flexible"` | No | Default `strict`: Struan subset only. `flexible`: allow grounded category-style collapse of weak-fit role clusters |

Request body size capped by `TAILOR_REQUEST_MAX_BYTES` (default 65536).

### Responses

#### 200 OK

```json
{
  "cv": "<base64-encoded .docx>",
  "curatedJson": { "name": "…", "contact": {}, "summary": [], "…": "…" },
  "builderVersion": "1.0.0",
  "curationMode": "strict",
  "model": "anthropic/sonnet",
  "usage": {
    "promptTokens": 12000,
    "completionTokens": 1500,
    "totalTokens": 13500
  },
  "remaining": 4,
  "resetTime": 1717632000000
}
```

| Field | Description |
|-------|-------------|
| `cv` | Base64 `.docx` |
| `curatedJson` | Schema-valid curated CV (caller-owned for history/regen) |
| `builderVersion` | Mechanical builder semver; keep with JSON for style-stable regen |
| `curationMode` | Echo of the mode used for this tailor (`strict` or `flexible`) |
| `remaining` / `resetTime` | More restrictive of dual rate-limit buckets |

Total JSON response size capped by `TAILOR_RESPONSE_MAX_BYTES` (default 2MiB).

#### 400 Bad Request

Invalid JSON, oversize body/JD, missing IP, or validation errors (client-safe `error` string).

#### 401 Unauthorized

Missing/invalid Bearer token (key is configured but presentation failed).

#### 405 Method Not Allowed

`GET /api/tailor-cv` → `{ "error": "Method not allowed. Use POST." }`

#### 422 Unprocessable Entity

Curator JSON parse/schema/size failure, builder failure, or oversize response — no `cv` / `curatedJson` in body.

#### 429 Too Many Requests

Rate limit exceeded (see above).

#### 503 Service Unavailable

Auth misconfiguration (`TAILOR_API_KEY` unset, production bypass hard-block), master CV unavailable, curator prompt missing `{{MASTER_CV_JSON}}`, rate-limit Redis failure, or LLM service error (client-safe messages).

#### 500 Internal Server Error

Unexpected failures: `{ "error": "Internal server error. Please try again later." }`

---

## Error Envelope

Errors use `{ "error": string }`. `remaining` / `resetTime` appear on 429 only.

---

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `TAILOR_API_KEY` | Shared secret for Bearer auth | — (required in deploy) |
| `TAILOR_AUTH_INSECURE_BYPASS` | Local/dev skip Bearer (hard-blocked in production-like deploys) | off |
| `MASTER_CV_JSON` / `MASTER_CV_PATH` | Canonical master CV | Prefer env body; path must not be world-readable |
| `TAILOR_MODEL` | Curator model (`provider/model`) | `anthropic/sonnet` |
| `RATE_LIMIT_MAX` | Per-IP sliding-window ceiling | `5` |
| `RATE_LIMIT_SECRET_MAX` | Per-shared-secret ceiling | half of `RATE_LIMIT_MAX` (min 1) |
| `RATE_LIMIT_WINDOW` | Sliding window length (ms) | `60000` |
| `TAILOR_REQUEST_MAX_BYTES` / `TAILOR_JD_MAX_CHARS` | Ingress limits | `65536` / `50000` |
| `TAILOR_CURATED_JSON_MAX_BYTES` / `TAILOR_RESPONSE_MAX_BYTES` | Egress limits | `512000` / `2097152` |

Full catalog with comments: [`.env.example`](../../.env.example)

---

## Operator commands

```bash
# Live smoke (Bearer + dual artifacts + grounding/JD-fit judges) — not part of npm test
npm run smoke -- http://localhost:3000

# Regen .docx from retained curated JSON (no LLM)
npm run regen-docx -- path/to/curated.json out.docx --builder-version=1.0.0
```

---

## `curl` Examples

```bash
curl http://localhost:3000/api/hello

curl -s -X POST http://localhost:3000/api/tailor-cv \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TAILOR_API_KEY" \
  -d '{"jobDescription": "Senior React engineer. Requirements: TypeScript, React, Node.js."}' \
  | tee /tmp/tailor.json | jq -r '.cv' | base64 -d > /tmp/cv.docx
```
