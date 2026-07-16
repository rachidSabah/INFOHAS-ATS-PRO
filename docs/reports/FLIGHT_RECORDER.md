# Enterprise Flight Recorder

The Flight Recorder is the **single** observability seam for every AI
execution. It produces a structured `FlightRecord` capturing the full context
of a call: prompts, provider, model, latency, tokens, cost, and the outputs of
the Reflection / QA / Validation / Decision engines.

## What it records

`src/lib/ai/flight-recorder.ts` → `FlightRecord`:

- `scope`, `feature`, `module`
- `provider`, `model`, `status`
- `latencyMs`, `promptTokens`, `completionTokens`, `cost`
- `reflection`, `qa`, `validation`, `decision` (engine outputs)
- `error` (if any)

## Emission points

`recordAI` emits a record on `AfterPersist`. Engines write their verdicts via
the hook registry (`OnReflection`, `OnQA`, `OnValidation`, `OnDecision`).

## Client read-model (in-session)

`src/lib/store/flight-slice.ts` is a Zustand slice that buffers records captured
during the current browser session (capped ring buffer, `FLIGHT_LOG_CAP = 500`).
It is the data source for the **Flight Recorder Console** UI
(`src/components/app/modules/FlightRecorderConsole.tsx`), which renders the
execution timeline, prompt/response versions, provider/model, latency/cost/
tokens, and per-engine verdicts — with filtering, search, and replay.

## Privacy

- No server store — records live in the browser session only.
- Recordings (video interviews) are stored in IndexedDB; only metadata reaches
  the store/cloud (mirrors the lightweight-metadata pattern).
- This matches the offline, privacy-friendly design of the interview recorder.

## Reuse, don't duplicate

The Flight Recorder is the **only** execution trace. UI and analytics consume
its records; nothing re-implements tracing.
