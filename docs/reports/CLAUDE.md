\# CLAUDE.md



\## Mission



This repository implements an enterprise ATS Resume Intelligence Platform.



All work must preserve existing functionality while improving reliability, determinism, maintainability, and user experience.



\## Core Principles



\- Audit before implementation.

\- Reuse before Rewrite.

\- Extend before Replace.

\- Never duplicate existing architecture.

\- Preserve backward compatibility.

\- Maintain a single AI orchestration pipeline.

\- Maintain a single provider abstraction layer.

\- Maintain a single shared memory system.

\- Maintain a single workflow engine.

\- Maintain a single context manager.

\- Implement incrementally.

\- Stop after each completed phase and await approval.



\## Engineering Standards



\- Do not remove working features.

\- Prefer composition over inheritance.

\- Use dependency injection where appropriate.

\- Maintain Cloudflare compatibility.

\- Validate every change.

\- Run regression checks before completion.



\## AI Platform Standards



Every AI feature must support:



\- Provider abstraction

\- Structured logging

\- Retry logic

\- Timeouts

\- Streaming

\- Reflection

\- QA validation

\- AI Flight Recorder

\- Developer Diagnostics Mode



\## Resume Platform Standards



Always keep Resume Builder, Resume Optimizer, ATS Engine, AI Copilot, Interview Prep, MCP integration, Memory, and Company Intelligence synchronized through shared state.



No subsystem may maintain an independent copy of the resume or job description.



All modifications must update the shared document model.

