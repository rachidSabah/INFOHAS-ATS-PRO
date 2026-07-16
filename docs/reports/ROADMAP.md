# Roadmap

ResumeAI Pro is feature-complete through **Phase 8.1.5 (Interview Experience
Platform)** and released as **v1.0.0**. This roadmap covers post-1.0 direction.

## Released (v1.0.0)

- Universal AI Pipeline (provider abstraction, failover, streaming, reflection,
  QA, validation, decision)
- Enterprise AI Core + Prompt/Context builders
- Enterprise Flight Recorder (observability + replay)
- Reflection / QA / Validation / Decision engines
- Adaptive Interview Engine
- Recruiter Intelligence & Analytics Platform
- Interview Experience Platform (Candidate, Recruiter, Admin, Flight Recorder
  Console, Analytics, Explainability, Executive Reports, Scenario/Persona mgmt)
- Cloudflare-native deployment (Pages + Workers + D1 + KV)

## Near-term (post-1.0)

- Real-time collaboration on resume editing (Cloudflare Durable Objects)
- Async video interview review queue + panel scoring
- Expanded provider roster (Azure OpenAI, AWS Bedrock adapters)
- Mobile app shell (PWA installability is already in place)
- Internationalization (i18n) beyond English

## Mid-term

- Organization/team workspaces with shared branding
- ATS integration (Greenhouse, Lever) for direct apply
- Usage analytics dashboard for admins
- Self-host guide (Docker) — the `Dockerfile`/`docker-compose.yml` already exist

## Guiding principles

No planned change duplicates the single AI pipeline, provider layer, shared
memory, workflow engine, context manager, or Flight Recorder. New capabilities
**consume** these services; they do not re-implement them.
