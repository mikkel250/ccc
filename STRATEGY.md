---
name: CCC
last_updated: 2026-09-03
---

# CCC Strategy

## Target problem

In-demand professionals get more recruiter inbound than they can answer honestly. Each reply needs a JD-specific CV; doing that by hand steals time from the searches they actually chose. Pivot applications do not create this inbound — recruiters write to people they can already place.

## Our approach

Win with one deep, honest Master CV and in-field (`strict`) curation: quality comes from profile depth, not from pivot translation and not from a thin ChatGPT paste. The same tailor backend serves unattended inbound drafts (scan → CV → reply + attach) and on-demand JDs (web UI, sync). One curator pass; a human reads the artifacts.

## Who it's for

**Primary:** In-demand professional (software engineers first; same pattern for anyone with heavy inbound). They're hiring CCC to auto-draft in-field recruiter replies with a tailored CV attached so they can keep attention on jobs they picked.

**Secondary:** The same person pasting a JD (later: a link) in a web UI for a CV right now — sync, same profile, same backend.

## Key metrics

- **Submit bar** — on a pinned in-field JD sample, would you send this CV to that recruiter? Operator read of smoke `.docx` / JSON until the product exists.
- **Grounding** — no invented facts, metrics, employers, or tools on that same read. Can get worse; that is a fail.
- **Rewrite rate** — share of inbound drafts sent without a manual CV rewrite. Product analytics later; smoke is the stand-in now.
- **Inference cost** — same submit bar at lower `TAILOR_REASONING_EFFORT` or a smaller model. Measured from smoke config + the eyeball, not a dashboard.

## Tracks

### In-field curator quality

Dial the `strict` prompt until in-field smoke CVs clear the submit bar, then cheapen the call (less thinking, smaller models) without losing it.

_Why it serves the approach:_ the backend is only worth sharing across inbox and UI if `strict` is actually good.

### Master profile

Keep one complete Master CV as the quality source — granular, honest, not duplicated per industry.

_Why it serves the approach:_ that depth is the bet against “paste a JD into ChatGPT.”

### Two fronts, one API

Scheduled inbox scan (default ~5am, extra windows if they want faster replies) and on-demand sync tailor call the same curation. Do not fork prompts per surface.

_Why it serves the approach:_ inbound is the paid job; the UI is the same engine when they are sitting there.

## Not working on

- Pivot / `flexible` as the commercial path (the flag may stay; do not invest until in-field is excellent)
- Matching the old Anthropic project’s quality on out-of-field JDs
- LLM-as-judge in the tailor loop or as a smoke gate
- Heavy mechanical grounding allowlists (add only if manual failures justify it)
- Page-count as a hard requirement
- Native batch APIs inside Next.js (later worker; not required for inbox scan + sync UI)
- BYOK (we meter usage on our keys)
- Crawling JD URLs (later)
