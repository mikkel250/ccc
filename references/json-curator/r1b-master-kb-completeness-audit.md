# R1b Master↔KB completeness audit

Date: 2026-07-20
Master: `secrets/master_cv.json` (local, gitignored)
KB: `knowledge-base/*.md` (excludes `test-jds/`)

## Master experience titles
- Software Engineer, Stealth Startups (Contract)
- Software Engineer - Full Stack, SFMOMA
- UI/UX Developer (Contract), Intrinsic (Alphabet/Google X)
- Software Engineer - Front End (Contract), Jefferson Health
- Software Engineer - Front End, Dental Game Plan
- Software Engineer - Front End, Kul Inc.
- Manager, Marathon Products, Inc.

## Master subrole / project headings
- AI Assistant — Founder Project
- Multi-Agent Orchestration System — personal R&D
- NL-to-SQL Analytics Platform — contracted engagement for a profitable stealth startup client
- DeFi Analytics Dashboards — delivered to a stealth startup
- [project] Personal Portfolio Website
- [project] eCommerce Site Demo
- [project] DeFi Analytics Dashboards

## Titles with weak/no KB coverage (heuristic)
- (none)

## Subrole/project headings with weak/no KB coverage (heuristic)
- NL-to-SQL Analytics Platform — contracted engagement for a profitable stealth startup client
- [project] Personal Portfolio Website
- [project] eCommerce Site Demo

## experience.md ## / ### headings (manual org triage)
- Overview
- ✅ FACT-CHECK GUIDE (For AI Responses)
- Software Engineer - Freelance 
- Software Engineer - Full Stack | San Francisco Museum of Modern Art
- UI/UX Developer | Intrinsic (Alphabet/Google X)
- Software Engineer - Front End | Jefferson Health
- Software Engineer - Front End | Dental Game Plan
- Software Engineer - Front End | Kul Inc.
- Career Transition & Background
- Core Competencies & Specializations
- Companies & Tenure (Cite These Exactly)
- Key Metrics (Use Exact Numbers)
- ❌ NEVER Say
- Key Accomplishments 
- Technologies and Skills
- Business Impact
- Technical Challenges & Solutions
- Context
- Key Accomplishments
- Technologies & Skills
- Business Impact
- Technical Challenges & Solutions
- Context
- Key Accomplishments
- Technologies & Skills
- Business Impact
- Technical Challenges & Solutions
- Context
- Key Accomplishments
- Technologies & Skills
- Business Impact
- Technical Challenges & Solutions
- Context
- Key Accomplishments
- Technologies & Skills
- Business Impact
- Technical Challenges & Solutions
- Context
- Key Accomplishments
- Technologies & Skills
- Business Impact
- Technical Challenges & Solutions
- Pre-Engineering Experience (Brief)
- Technical Expertise
- Soft Skills & Leadership
- What I Bring to Teams

## %-metrics in KB absent as literals from master JSON
- 15%

## $-metrics in KB absent as literals from master JSON
- $0
- $0.00
- $0.001
- $0.002
- $0.02
- $0.10
- $0.20
- $0.50
- $1.00
- $1M
- $40
- $5
- $500

## Master certifications
- JavaScript (Intermediate) — HackerRank, Jun 2026
- JavaScript (Basic) — HackerRank, Jun 2026
- Theme Development — Shopify, 2021
- SEO Certifications (Fundamentals, Keyword Research, Backlink Management, Local, Mobile) — SEMrush Academy, 2021

## Certs with weak KB coverage (heuristic)
- JavaScript (Intermediate) — HackerRank, Jun 2026
- JavaScript (Basic) — HackerRank, Jun 2026
- SEO Certifications (Fundamentals, Keyword Research, Backlink Management, Local, Mobile) — SEMrush Academy, 2021

## KB skill tokens not found in master JSON (triage)
- 2019)
- 2020-2021):
- 2021):
- 2021-2023):
- 2023):
- 2023-2025):
- AI/LLM: Google
- AI/ML Integration: OpenAI API
- API flexibility
- APIs & Services: LLM APIs (Google
- APIs)
- APIs: Google
- ARIA attributes
- ASP.NET (no experience prior to SFMOMA)
- ASP.NET Core
- ASP.NET Core/C# (SFMOMA
- ASP.NET Core: Razor Pages
- AWS (EC2
- AWS Lambda patterns
- AWS: EC2
- Aceternity UI)
- Adobe XD: Mockup interpretation
- Angular: Components
- Axe DevTools
- Azure DevOps
- Azure DevOps: Boards
- Azure: Azure DevOps
- BEM methodologies
- Backend: FastAPI
- Bazel (Google)
- Bazel builds
- Bitbucket
- Bitbucket: Repository hosting
- Blockchain/Web3: Solidity
- Bootstrap 4
- Bootstrap 4: Grid system
- Build/Test: Webpack
- C# integration
- CLI)
- CSS Animations: Transitions
- CSS3
- CSS3: Modern layouts
- Chrome DevTools
- Chrome DevTools: Debugging
- Clarifai
- ClickHouse: complex queries
- CloudFront
- CloudFront)
- Communication: Twilio (calls
- Core Web Vitals

## Decisions (signed off 2026-07-20)

### Batch 1 — metrics
- **Keep / merge into master:** SFMOMA +15% addressable audience; Jefferson ~72h→~24h + ~40,000 employees; Dental Game Plan 6 sites (40+ pages) + 100% retention; SFMOMA ~$3 million annual online ticket sales.
- **Drop:** Intrinsic $1M+ equipment (speculative); all `meta-project.md` operating-cost / pricing-table `$` amounts.

### Batch 2 — subroles / projects / certs
- **Keep:** NL-to-SQL stealth subrole; Portfolio + eCommerce; HackerRank JS certs; Node.js (Basic); SEMrush SEO; Shopify Theme Development.
- **Enrich F:** Portfolio + eCommerce bullets expanded from `knowledge-base/projects.md`.

### Batch 3 — skills / extra projects
- **Large skills lists** in master (curator cuts per JD), including Aceternity, Framer Motion, Stripe, Firebase, Redux, Clarifai, Twilio (skill only).
- **Add project:** Face Recognition App (Clarifai).
- **Drop project:** Twilio Communication Demos (re-add later if needed).

### Applied to `secrets/master_cv.json`
Merges above applied locally (gitignored).

## Sign-off

- [x] Triaged weak titles / subroles / metrics / skills / certs
- [x] Keepers merged into `secrets/master_cv.json` OR drops listed below
- [x] Explicit drops:
  - Intrinsic $1M+ equipment operators (speculative)
  - All `meta-project.md` operating-cost / pricing-table `$` amounts
  - Twilio Communication Demos project

**Status:** **R1b signed off** — completeness gate cleared for planning.
