# CV Tailoring API Reference

CV tailoring API — `POST /api/tailor-cv` accepts a job description and returns a tailored CV as a base64-encoded `.docx`. Base URL: `http://localhost:3000` in dev; Railway URL in production.

---

## Authentication

None. The MVP is single-user with no auth layer. A shared secret may be added in a future revision.

---

## Rate Limiting

In-memory burst limiter keyed on **IP address** (not `sessionId`).

| Parameter | Env var | Default |
|-----------|---------|---------|
| Max requests per window | `RATE_LIMIT_MAX` | `5` |
| Window duration | `RATE_LIMIT_WINDOW` | `60000` ms (1 minute) |

State resets on process restart (stateless MVP). When blocked:

```json
HTTP 429
{
  "error": "Too many requests. Please wait before trying again.",
  "remaining": 0,
  "resetTime": 1717632000000
}
```

`resetTime` is a Unix timestamp in milliseconds indicating when the oldest request in the window expires.

---

## `GET /api/hello`

Health probe. Confirms the Node process is running. No LLM call, no knowledge base access.

**Request:** No body, no query parameters.

**Response 200:**
```json
{
  "service": "cv-tailoring-api",
  "status": "ok"
}
```

No other status codes for normal operation.

---

## `POST /api/tailor-cv`

Accepts a job description, tailors the career knowledge base to that role via LLM, and returns the result as a base64-encoded `.docx`.

### Request

`Content-Type: application/json`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `jobDescription` | `string` | Yes | Raw job description text. Must be non-empty. |
| `sessionId` | `string` | No | Optional caller-provided session identifier. Has no effect on rate limiting (rate limit is IP-keyed). |

```json
{
  "jobDescription": "Senior TypeScript engineer. Requirements: React, Node.js, 5+ years.",
  "sessionId": "optional-caller-id"
}
```

### Responses

#### 200 OK

```json
{
  "cv": "<base64-encoded .docx>",
  "model": "anthropic/claude-sonnet-4-6",
  "usage": {
    "promptTokens": 12000,
    "completionTokens": 1500,
    "totalTokens": 13500
  },
  "remaining": 4,
  "resetTime": 1717632000000
}
```

| Field | Type | Description |
|-------|------|-------------|
| `cv` | `string` | Base64-encoded `.docx` file |
| `model` | `string` | Model used for generation (`provider/model`) |
| `usage.promptTokens` | `number` | Input token count |
| `usage.completionTokens` | `number` | Output token count |
| `usage.totalTokens` | `number` | Sum of input + output |
| `remaining` | `number` | Requests remaining in current rate-limit window |
| `resetTime` | `number` | Unix ms timestamp when the window resets |

#### 400 Bad Request

Missing `jobDescription`:
```json
{ "error": "jobDescription is required." }
```

Non-string or empty `jobDescription`:
```json
{ "error": "jobDescription must be a non-empty string." }
```

#### 405 Method Not Allowed

`GET /api/tailor-cv`:
```json
{ "error": "Method not allowed. Use POST." }
```

#### 429 Too Many Requests

```json
{
  "error": "Too many requests. Please wait before trying again.",
  "remaining": 0,
  "resetTime": 1717632000000
}
```

#### 503 Service Unavailable

LLM provider is unreachable or returns a service error:
```json
{ "error": "AI service error. Please try again." }
```

#### 500 Internal Server Error

All other unexpected errors:
```json
{ "error": "Internal server error. Please try again later." }
```

---

## Error Envelope

All error responses use `{ "error": string }` as the envelope. The `remaining` and `resetTime` fields are added only for 429 responses.

---

## Environment Variables

Full catalog with comments: [`.env.example`](../../.env.example)

| Variable | Purpose | Default | Required |
|----------|---------|---------|----------|
| `TAILOR_MODEL` | LLM used for CV generation (`provider/model`) | `anthropic/sonnet` | Yes |
| `OPENAI_API_KEY` | Direct OpenAI access | — | One of these |
| `ANTHROPIC_API_KEY` | Direct Anthropic access | — | One of these |
| `GOOGLE_API_KEY` | Direct Google Gemini access | — | One of these |
| `OPENROUTER_API_KEY` | OpenRouter unified gateway (enables `openrouter/*` models) | — | One of these |
| `DEEPSEEK_API_KEY` | Direct DeepSeek access | — | One of these |
| `RATE_LIMIT_MAX` | Max requests per IP per window | `5` | No |
| `RATE_LIMIT_WINDOW` | Rate-limit window duration in ms | `60000` | No |
| `LANGFUSE_TRACING` | Enable Langfuse prompt tracing (`true`/`false`) | `false` | No |
| `PORT` | HTTP port (Railway sets this automatically) | `3000` | No |

---

## `curl` Examples

### Health check
```bash
curl http://localhost:3000/api/hello
```

### Tailor CV (happy path — saves to `/tmp/cv.docx`)
```bash
curl -s -X POST http://localhost:3000/api/tailor-cv \
  -H "Content-Type: application/json" \
  -d '{"jobDescription": "Senior React engineer. Requirements: TypeScript, React, Node.js."}' \
  | jq -r '.cv' | base64 -d > /tmp/cv.docx
```

### Validation error (400)
```bash
curl -s -X POST http://localhost:3000/api/tailor-cv \
  -H "Content-Type: application/json" \
  -d '{}'
# → {"error":"jobDescription is required."}
```

### Method not allowed (405)
```bash
curl http://localhost:3000/api/tailor-cv
# → {"error":"Method not allowed. Use POST."}
```
