# Professional Experience

**Last Updated:** October 28, 2025  
**Version:** 2.0

## Overview

Software Engineer with ~6 years of hands-on experience shipping production-ready features across diverse technology stacks, from React/TypeScript at startups to Angular at Google scale to ASP.NET at cultural institutions. Proven track record of rapidly adapting to new technologies, optimizing performance by 18%-25%, and delivering user-facing features that drive measurable business impact.

## ✅ FACT-CHECK GUIDE (For AI Responses)

### Companies & Tenure (Cite These Exactly)
1. **SFMOMA** (September 2023 - May 2025) = 1 year 8 months
2. **Intrinsic (Google/Alphabet)** (January 2023 - May 2023) = 5 months  
3. **Jefferson Health** (November 2021 - January 2023) = 1 year 2 months
4. **Dental Game Plan** (April 2021 - December 2021) = 8 months
5. **Kul Inc.** (May 2020 - March 2021) = 10 months

### Key Metrics (Use Exact Numbers)
- **Performance improvements:** 18% (Kul), 25% (Jefferson Health)
- **Jefferson Health IT system:** 72 hours → 24 hours (3X improvement), 40,000 employees impacted
- **Angular learning:** ~3 weeks to working proficiency at Intrinsic/Google
- **SFMOMA:** $3 million annual online ticket sales, 1 year 8 months tenure, expanded museum accessibility to visitors with disabilities through WCAG 2.1 AA compliance, potentially increasing addressable audience by 15%.
- **Dental Game Plan:** Built 6 sites (40+ pages each), 100% client retention, 8 months tenure

### ❌ NEVER Say
- Specific team sizes (not documented for most roles)
- Budget amounts (not documented)
- Revenue impact (unless specifically stated above)
- "Led teams of X engineers" (trained teams, but no formal lead role)

---
## Software Engineer - Freelance 
**Duration:** May 2025 - present
**Location:** San Francisco, CA
### Key Accomplishments 
-	Designed a multi-agent orchestration system for routing coding tasks across frontier models based on task shape, risk, and cost/output tradeoffs — informed by sustained use of AI coding agents in both production and freelance work.
-	Independently built and delivered a full-stack analytics app using Python/FastAPI, ClickHouse, React, TypeScript, with RAG over schema/context, and uses Anthropic models that lets non-technical users converse naturally and receive validated, SQL-backed answers.
-	Evaluated 15–20 open-source and commercial models on SQL quality, instruction following, tool-use reliability, latency, and hosting tradeoffs; recommended managed APIs over self-hosting after cost/ops analysis showed production-viable OSS would need substantial GPU and infra.
-	Built a Pytest evaluation harness for LLM-generated ClickHouse SQL: pre-execution syntax validation, structured checks (execution success, schema/tenant constraints, returned data), and benchmark-style runs across dozens of parametrized NL→SQL cases with optional multi-model comparison.
-	Built a separate AI resume assistant with multi-provider fallback (Gemini, Claude, OpenAI) and LangSmith observability for production monitoring and output comparison. Deployed to production on Vercel.

### Technologies and Skills
Python (FastAPI), TypeScript, JavaScript, React, Remix, Anthropic, OpenAI, Gemini, and open source LLMs, prompt design, context engineering, RAG, LangSmith, model/tool evaluation, Pytest, automated validation, regression testing, failure analysis, ClickHouse, ChromaDB, REST APIs

### Business Impact
Delivered all projects on time and within budget.

### Technical Challenges & Solutions
Evaluated 15-20 open source and commercial LLMs, building Pytest-based validation for tool use and SQL generation, including the various levels of hardware required to run each model. Recommended managed APIs over the original goal of self-hosting after cost/ops analysis showed production-viable OSS would need substantial GPU and infra.
Designed a multi-agent orchestration workflow that routes work across models based on task type, cost, and capability fit — specifically to compensate for where frontier coding agents fail. For example, most agents skip proper codebase orientation before starting large tasks. Built a dedicated agent using Gemini's 1M context window to scan first and hand structured findings downstream. Every implementation step also runs through a reviewer subagent that surfaces areas needing human attention — downstream dependencies, affected modules, edge cases — so his review effort goes where it's actually needed. 

---

## Software Engineer - Full Stack | San Francisco Museum of Modern Art
**Duration:** September 2023 - May 2025  
**Location:** San Francisco, CA

### Context
SFMOMA, one of the largest modern art museums in the US, needed to modernize their ticketing platform while maintaining complex integrations with Tessitura CRM. I was brought in as the sole engineer responsible for the entire front end of the ticketing system, serving thousands of daily visitors and managing millions in annual revenue.

### Key Accomplishments

- **Led WCAG 2.1 AA Compliance Initiative:** Spearheaded accessibility overhaul across entire ticketing platform using Axe DevTools and manual screen reader testing. Achieved zero critical defects in pre-audit QA, ensuring legal compliance and expanding access to diverse audiences including visitors with disabilities - potentially increasing addressable market by 15%.

- **Streamlined Checkout Integration:** Implemented third-party payment widget to replace custom credit card form, adapting fonts and colors to match SFMOMA's design system for visual consistency. Ensured smooth integration with existing ticketing flow while maintaining PCI compliance through vendor-managed payment processing.

- **Pioneered Testing Infrastructure:** Introduced Jest testing framework to legacy codebase with zero prior test coverage. Created initial test suite and documented testing patterns for team adoption. Set foundation for future CI/CD integration.

- **Built Internal Admin Tools:** Created GUI interface allowing non-technical staff to update CRM database fields without editing raw JSON. Eliminated bottleneck where all updates had to go through head of CRM, democratizing database updates across marketing and operations teams. Reduced errors from manual JSON editing while maintaining data integrity with Tessitura CRM.

- **Enhanced Interactive Gallery Visualization Tool:** Took initiative beyond primary responsibilities to revive dormant 3D museum model sitting unused on AWS EC2. Partnered with Senior Technical Program Manager to augment model with gallery restriction overlays, implementing text annotations and color-coding system in collaboration with legal and exhibition design teams. Transformed forgotten asset into practical planning tool, eliminating need to search document archives for space constraints.

- **Managed Critical System Upgrades:** Oversaw all front end preparation and post-upgrade QA for .NET Core migration and Tessitura platform upgrade, ensuring zero-downtime deployment for system processing millions in annual transactions.

### Technologies & Skills
ASP.NET Core, Razor Pages, JavaScript ES6+, HTML5, SCSS, Tessitura CRM API, Jest, Axe DevTools, Azure DevOps, Git, Jira, Bitbucket, Gulp, Node.js, NPM, JQuery

### Business Impact
Expanded museum accessibility to visitors with disabilities through WCAG 2.1 AA compliance, potentially increasing addressable audience by 15%. Revived dormant technology investment into practical tool routinely used by legal and exhibition teams. Improved internal efficiency by eliminating CRM bottlenecks and reducing JSON-related data errors. Maintained stability of ticketing platform processing ~$3 million in annual online ticket sales with zero critical incidents during tenure.

### Technical Challenges & Solutions
**Challenge:** Inherited legacy system, with 400+ item backlog, while simultaneously managing critical upgrades (.NET/Tessitura migration, payment provider transition). Tessitura backend - designed for performing arts venues - required constant adaptation for museum use cases, handling ticketing, CRM, donations, and memberships through one tightly-coupled system.
**Solution:** Balanced sprint work between backlog reduction and strategic improvements. Learned Tessitura's niche architecture to work effectively within its constraints. Prioritized high-impact items while maintaining system stability during major transitions. Successfully completed payment provider migration and .NET/Tessitura upgrade without service interruption despite system complexity.

---

## UI/UX Developer | Intrinsic (Alphabet/Google X)
**Duration:** January 2023 - May 2023  
**Location:** San Francisco, CA (Contract via Nelson Connects)

### Context
Intrinsic, an Alphabet company democratizing industrial robotics, needed to build enterprise-grade workflow tools for robotics engineers. Joined a team of 6 working in Google's massive monorepo to deliver UI components for their custom robotics platform.

### Key Accomplishments

- **Delivered at Google Scale:** Shipped production Angular/TypeScript components through Google's rigorous engineering process - Piper version control, Bazel builds, multi-stage code reviews. Maintained 100% test coverage and zero P1 incidents across all features.

- **Translated Design to Production:** Partnered with product designers to convert Figma prototypes into pixel-perfect, responsive UI components using Material Design system. Components processed real-time robotics telemetry data, displaying complex workflows for non-technical operators managing $1M+ equipment.

- **Accelerated Team Velocity:** Contributed to 2-week sprint cycles with clear technical documentation and proactive communication. Presented technical tradeoffs to PMs that helped prioritize features, resulting in on-time delivery of roadmap.

### Technologies & Skills
Angular 15, TypeScript 5, Material UI, RxJS, Google Piper/Bazel, Kubernetes, Jasmine/Karma, Figma

### Business Impact
Contributed to enterprise robotics platform. Delivered Angular/TypeScript components that passed Google's rigorous code review standards and maintained zero P1 incidents throughout engagement.

### Technical Challenges & Solutions
**Challenge:** Learn Angular and Google's proprietary internal frameworks (custom Material UI and testing libraries) with no prior Angular experience while delivering production code from day one.
**Solution:** Demonstrated exceptional self-directed learning by analyzing existing codebases and extracting patterns from similar projects in the monorepo, often with little or no documentation. Within ~3 weeks, reached independent working proficiency and was shipping production components that passed Google's rigorous multi-stage review process. Proved ability to quickly master new technologies through code comprehension and pattern recognition rather than formal documentation.
---

## Software Engineer - Front End | Jefferson Health
**Duration:** November 2021 - January 2023  
**Location:** Remote (Contract via TekSystems)

### Context
Jefferson Health, a 40,000-employee healthcare system and university, needed to modernize their branding. Initially contracted for 4 months as part of a 3-developer team, I was retained for 14 months total and promoted to lead developer after demonstrating exceptional results. Primary focus was the Shopify storefront, with additional contributions to the Marcus Institute website and development of an internal React-based ticket routing system.

### Key Accomplishments

- **Built React-Based IT Routing System:** Developed internal support ticket routing application using React, TypeScript, and Next.js that intelligently directed requests across departments. Reduced average ticket response time from 72 hours to 24 hours (3X improvement), directly impacting 40,000 employees' productivity.

- **Modernized Development Workflow:** Single-handedly transformed direct-to-production edits into professional CI/CD pipeline. Migrated from GitLab to GitHub integration, implemented protected branches, established PR review process, and trained entire team on Shopify CLI. Zero deployment failures after implementation.

- **Led Shopify 2.0 Migration:** Architected and executed complete platform migration from Shopify 1.x to 2.0. Converted 50+ Liquid templates to JSON schema, refactored legacy code into modular sections, and optimized data loading. Admin panel responsiveness doubled.

- **Implemented Design System:** Collaborated with design team to implement company-wide visual identity on specific digital properties. Delivered pixel-perfect components matching new brand guidelines, ensuring consistency across Jefferson Health web properties serving millions of patients annually.

- **Performance Optimization Success:** Reduced storefront load time by 25% using Lighthouse and PageSpeed insights. Implemented critical CSS inlining, tree shaking, image lazy loading, and JavaScript deferral strategies that improved Core Web Vitals scores from "Needs Improvement" to "Good" across all metrics.

- **Contract extended due to outstanding Performance:** Originally contracted for 4 months, contract was extended an additional 10 months due to outstanding performance during original tenure, for a total of a 14 month contract.

### Technologies & Skills
React 18, TypeScript 4, Next.js 13, Shopify Liquid, JavaScript ES6+, SCSS, GitHub Actions, Shopify CLI, GraphQL, Webpack, Lighthouse

### Business Impact
IT routing system improved employee productivity across the 40,000-person organization by eliminating manual ticket routing between departments, reducing average response time from 72 to 24 hours. Shopify performance improvements (25% faster load times) enhanced user experience for customers purchasing wellness products and booking services. Development workflow transformation enabled parallel development for 3-person team and eliminated production incidents that previously occurred regularly, establishing a professional SDLC where none existed before.

### Technical Challenges & Solutions

**Challenge:** Jefferson Health's Shopify team was editing production code directly with no version control, code review, or testing. While Shopify offered basic rollback functionality (restore by date), there was no commit history or context about what changed, making it nearly impossible to understand or safely revert changes. Multiple developers couldn't work simultaneously, and deployment failures were accepted as normal.

**Solution:** Architected and implemented complete SDLC transformation:

- **Version Control:** Migrated codebase to Shopify's GitHub integration with proper branching strategy (main, staging, feature branches). Now had meaningful commit messages and full change history instead of just timestamps.
- **Parallel Development:** Multiple developers could work on separate feature branches simultaneously, then merge to main through PR process - impossible in previous direct-edit workflow.
- **Code Review:** Established required PR review process with protected branches, ensuring all changes were reviewed before reaching production.
- **Staging Environment:** Set up proper staging/testing phase using Shopify CLI for local development and staging environment for validation before production deployment.
- **Smart Rollback:** Git history meant reverting changes was now surgical - could identify exactly what changed and why, rather than blindly restoring to a date and hoping for the best.
- **Team Training:** Created comprehensive documentation and conducted training sessions to ensure team adoption of new workflow.

**Impact:** Zero deployment failures post-implementation. Team velocity increased as developers could work in parallel without conflicts. When issues arose, rollbacks went from "restore to a date and cross fingers" to "revert specific commit with full context."

---

## Software Engineer - Front End | Dental Game Plan
**Duration:** April 2021 - December 2021  
**Location:** Remote

### Context

Dental Game Plan, a specialized web agency serving dental practices nationwide, operated with a custom Jekyll static site generator framework. As the sole front end developer, I owned the complete front end pipeline: receiving designer mockups approved by clients, building custom templates in the Jekyll SSG system, generating static sites, and collaborating with non-technical team members who handled client data population while I completed technical implementation.

### Key Accomplishments

- **Built 6 Large-Scale Client Sites:** Delivered 6 major client websites (40+ pages each) from designer mockups to production deployment. Translated Adobe XD designs into Jekyll templates using HTML, SCSS, Liquid, and YAML, then collaborated with team to populate client-specific content and launch sites on AWS infrastructure.

- **Created Reusable Template System:** Architected templates that could be reused across multiple clients with the same design. Initial template development took 2-3 weeks, but once built, could deploy identical design for new clients in 1-2 hours - dramatically reducing delivery time for subsequent clients choosing existing designs.

- **Enhanced Jekyll SSG Framework:** Made continuous improvements to the custom static site generator based on feedback from CEO, CTO, designers, and support staff. Increased framework flexibility and stability, making it easier to implement client customizations and new features.

- **Enabled Non-Technical Team Contributions:** Built content management workflow that allowed non-developers to populate client data independently, with me handling technical implementation. This division of labor accelerated overall delivery and freed developers to focus on template creation rather than data entry.

- **Achieved 100% Client Retention:** All 6 large-scale sites I built remain active in production years after deployment, demonstrating high-quality implementation and client satisfaction. Each site continues serving dental practices with 40+ pages of content, consistent performance, and zero critical issues requiring rebuilds.

### Technologies & Skills
React 17, TypeScript, Next.js, Jekyll, Liquid, YAML, HTML5, SCSS, AWS EC2, Git, Adobe XD

### Business Impact

Reusable template system transformed economics of site delivery - first site of a design took 2-4 weeks, subsequent sites with same design took 1-2 hours. This enabled company to offer "proven designs" at lower cost/faster delivery, becoming competitive advantage for client acquisition. Six large sites delivered represented significant revenue during 8-month tenure. Notably, **100% of clients I built sites for remain active customers** - all 6 sites are still running in production years later, demonstrating quality and client satisfaction with deliverables.

### Technical Challenges & Solutions
**Challenge:** Building reusable Jekyll templates that could accommodate diverse client needs while maintaining code quality and avoiding technical debt as template library grew.

**Solution:** Established modular component architecture with clear separation between core template structure and customizable elements. Created comprehensive documentation of template patterns and YAML configuration options. This enabled non-developers to safely make content changes while I maintained technical foundation, scaling to 6 production sites without architectural refactoring.

---

## Software Engineer - Front End | Kul Inc.
**Duration:** May 2020 - March 2021  
**Location:** Remote

### Context
Early-stage startup in the health and beauty space exploring multiple business models. As the second technical hire, I owned the entire customer-facing Shopify platform while the company pivoted through different strategies, requiring extreme agility and rapid iteration.

### Key Accomplishments

- **Led Complete Rebrand Migration:** Executed full platform rebrand from in 3 weeks with zero downtime. Migrated inventory, customer data, and order history while updating all visual assets and copy.

- **Built Data Visualization System:** Developed customer rewards dashboard using React with c3.js, d3.js, and Three.js for engaging data visualizations.

- **Optimized for Conversion:** Reduced page load time by 18% through aggressive optimization including deferral, code-splitting, tree-shaking, and lazy loading.

- **Startup Agility:** Successfully navigated 4 major pivots in business model, rapidly prototyping new features including subscription service, loyalty program, and B2B portal. Each pivot delivered within 2-3 week sprints, demonstrating exceptional adaptability.

### Technologies & Skills
Shopify Hydrogen, React 16, JavaScript ES6+, SCSS, Liquid, Three.js, d3.js, c3.js, Git, Bitbucket, ThemeKit, webpack

### Business Impact

Enabled company to rapidly test multiple business models through fast 2-3 week development cycles for each major pivot. Rebrand migration executed with zero downtime during critical transition period. Performance optimization (18% load time reduction) and flexible platform architecture supported business exploration across subscription service, loyalty program, and B2B portal strategies. Demonstrated ability to deliver high-quality technical work in fast-paced, high-ambiguity startup environment.

### Technical Challenges & Solutions
**Challenge:** Delivering 4 major business model pivots in under a year while maintaining code quality and avoiding technical debt from rushed implementations.

**Solution:** Built flexible component architecture that could be reconfigured rather than rebuilt for each pivot. Prioritized modularity and clean interfaces that allowed rapid feature swapping. Despite fast iteration cycles (2-3 weeks per pivot), platform remained stable with zero critical incidents throughout tenure.

---

## Career Transition & Background

### Pre-Engineering Experience (Brief)

Before transitioning to software engineering, I spent ~6 years in management and IT infrastructure roles that provided invaluable business context and leadership skills. As a manager at Marathon Products (2015-2020), I led cross-functional teams, managed stakeholder relationships, and drove process improvements that saved 100+ hours annually. I implemented help desk and bug tracking systems from scratch, improved response times by 50%, and administered ISO 9001 compliance programs.

This diverse background gives me a unique perspective on how software impacts business outcomes. I understand the frustrations of non-technical stakeholders, the importance of clear documentation, and how to translate technical concepts into business value. My management experience means I excel at cross-functional collaboration, mentoring junior developers, and navigating organizational dynamics that pure engineers sometimes struggle with.

**Why I transitioned to engineering:** The intellectual challenge and creative problem-solving of software development aligned perfectly with my passion for continuous learning and building impactful solutions.

---

## Core Competencies & Specializations

### Technical Expertise

- **Front End:** Deep expertise in web fundamentals (HTML5, CSS3, SCSS, JavaScript ES6+), with experience in the React ecosystem (React, TypeScript, Next.js), Angular, Jekyll, Shopify (Liquid), and ASP.NET Razor Pages. Passionate about performance optimization, achieving 18%-25% improvements across multiple projects.

- **Full-Stack:** Comfortable across the stack with Python, Node.js, ASP.NET, Next.js, and various databases. Can own features end-to-end and understand backend constraints when designing front end solutions.

- **AI/ML:** Early adopter integrating LLMs and generative AI into applications. Experience with prompt engineering, MCP orchestration, and practical ML applications in production (this AI agent you are speaking to is an example, as is the AI-powered analytics project). Designed a multi-agent orchestration workflow that routes work across models based on task type, cost, and capability fit — specifically to compensate for where frontier coding agents fail. Evaluating 15-20 open source and commercial LLMs, building Pytest-based validation for tool use and SQL generation, and shipping systems end to end that integrate AI as the sole engineer.

- **DevOps/Infrastructure:** Established CI/CD pipelines at multiple companies, comfortable with AWS, Azure, Docker, and Kubernetes. Focus on developer experience and deployment automation.

### Soft Skills & Leadership

Strong stakeholder communication refined through management background - I translate technical complexity into business impact. Natural mentor who's trained multiple teams on new technologies and workflows. Excel at async collaboration in remote environments while bringing energy to in-person brainstorming sessions.

### What I Bring to Teams

- **Business-Minded Engineering:** I ship features that move metrics, not just clean code. Every technical decision considers user impact and business value.

- **Rapid Adaptation:** Proven ability to join teams and start contributing immediately, regardless of tech stack. From React to Shopify to Google-scale Angular, I learn fast and ship faster.

- **Process Improvement DNA:** Consistently identify and fix workflow inefficiencies. Nearly every team I've joined has adopted better practices around testing, deployment, or documentation based on my initiatives.