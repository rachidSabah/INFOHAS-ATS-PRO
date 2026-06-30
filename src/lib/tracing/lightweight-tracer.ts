// ============================================================================
// Workers-Compatible Distributed Tracing — Section 13
// ============================================================================
// Full OpenTelemetry SDK has limited support in Workers runtime.
// This module uses Workers-native Trace Events / Logpush + a lightweight
// span-based tracer that's compatible with the CF Workers environment.
//
// Architecture:
//   - Tracer: creates spans with parent-child relationships
//   - Span: a single operation with timing + tags
//   - Exporter: sends spans via Logpush / Cloudflare Tail Workers
//   - OTel-compatible format: spans can be translated to OTLP for external APM
// ============================================================================

// ============================================================================
// Types
// ============================================================================

export type SpanStatus = 'ok' | 'error' | 'canceled';

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  status: SpanStatus;
  startTime: number;
  endTime: number;
  durationMs: number;
  attributes: Record<string, string | number | boolean>;
  events: Array<{
    name: string;
    timestamp: number;
    attributes?: Record<string, string | number | boolean>;
  }>;
}

export interface TraceExportEvent {
  type: 'trace';
  service: string;
  resource: Record<string, string>;
  spans: Span[];
  timestamp: string;
}

export interface TracingOptions {
  /** Service name for trace identification */
  serviceName: string;
  /** Maximum spans per flush (dynamically sized, default: 50) */
  maxSpansPerFlush: number;
  /** Whether to sample from the tail end (always-on percentage, default: 100) */
  sampleRate: number;
  /** Enable trace events for Cloudflare Logpush */
  enableLogpush: boolean;
  /** Export endpoint URL (for external APM like Grafana Tempo) */
  exportEndpoint?: string;
  /** Export API key */
  exportApiKey?: string;
}

const DEFAULT_TRACING_OPTIONS: TracingOptions = {
  serviceName: 'resumeai-pro',
  maxSpansPerFlush: 50,
  sampleRate: 1.0,
  enableLogpush: true,
};

// ============================================================================
// LightweightTracer
// ============================================================================

export class LightweightTracer {
  private options: TracingOptions;
  private spans: Span[] = [];
  private activeSpans = new Map<string, Span>();
  private traceId: string;

  constructor(options?: Partial<TracingOptions>) {
    this.options = { ...DEFAULT_TRACING_OPTIONS, ...options };
    this.traceId = this.generateId(32);
  }

  /**
   * Start a new span as a child of the current active span (or as root).
   */
  startSpan(name: string, attributes?: Record<string, string | number | boolean>): string {
    const spanId = this.generateId(16);
    const parentSpanId = this.getActiveSpanId();

    const span: Span = {
      traceId: this.traceId,
      spanId,
      parentSpanId,
      name,
      status: 'ok',
      startTime: performance.now(),
      endTime: 0,
      durationMs: 0,
      attributes: attributes ?? {},
      events: [],
    };

    this.activeSpans.set(spanId, span);
    return spanId;
  }

  /**
   * End a span, recording its duration.
   */
  endSpan(spanId: string, status: SpanStatus = 'ok', attributes?: Record<string, string | number | boolean>): void {
    const span = this.activeSpans.get(spanId);
    if (!span) return;

    span.endTime = performance.now();
    span.durationMs = span.endTime - span.startTime;
    span.status = status;
    if (attributes) {
      Object.assign(span.attributes, attributes);
    }

    this.activeSpans.delete(spanId);
    this.spans.push(span);

    // Auto-flush if we hit the limit
    if (this.spans.length >= this.options.maxSpansPerFlush) {
      this.flush();
    }
  }

  /**
   * Add an event to a span.
   */
  addEvent(
    spanId: string,
    eventName: string,
    attributes?: Record<string, string | number | boolean>,
  ): void {
    const span = this.activeSpans.get(spanId);
    if (!span) return;

    span.events.push({
      name: eventName,
      timestamp: performance.now(),
      attributes,
    });
  }

  /**
   * Set an attribute on a span.
   */
  setAttribute(spanId: string, key: string, value: string | number | boolean): void {
    const span = this.activeSpans.get(spanId);
    if (!span) return;
    span.attributes[key] = value;
  }

  /**
   * Flush all completed spans.
   * In a Worker, this sends spans via Logpush structured logs.
   */
  async flush(): Promise<void> {
    if (this.spans.length === 0) return;

    const batch = this.spans.splice(0, this.options.maxSpansPerFlush);

    if (this.options.enableLogpush) {
      // Log in CF Logpush-compatible JSON format
      // In production, these are consumed by Cloudflare Logpush → your log sink
      console.log(JSON.stringify(this.toExportEvent(batch)));
    }

    // If external APM endpoint is configured, send via fetch
    if (this.options.exportEndpoint && this.options.exportApiKey) {
      this.sendToApmEndpoint(batch).catch(() => {
        // Fire-and-forget — don't block the request on export
      });
    }
  }

  /**
   * Finalize the trace: flush remaining spans and return the final report.
   */
  async finalize(): Promise<{ traceId: string; spanCount: number }> {
    // End any remaining active spans
    Array.from(this.activeSpans.entries()).forEach(([spanId, span]) => {
      span.endTime = performance.now();
      span.durationMs = span.endTime - span.startTime;
      span.status = 'ok';
      this.spans.push(span);
    });
    this.activeSpans.clear();

    await this.flush();

    return {
      traceId: this.traceId,
      spanCount: this.spans.length, // remaining after flush (should be 0)
    };
  }

  /**
   * Create an in-memory queryable trace from completed spans.
   * Useful for rendering waterfall diagrams in dev/debug.
   */
  toTrace(): Span[] {
    return [...this.spans];
  }

  // ── Private ─────────────────────────────────────────────────────────

  private getActiveSpanId(): string | null {
    // Return the last-started span that hasn't been ended
    // Using reverse-iteration to find deepest active span
    const entries = Array.from(this.activeSpans.entries());
    for (let i = entries.length - 1; i >= 0; i--) {
      return entries[i][0];
    }
    return null;
  }

  private toExportEvent(batch: Span[]): TraceExportEvent {
    return {
      type: 'trace',
      service: this.options.serviceName,
      resource: {
        'service.name': this.options.serviceName,
        'telemetry.sdk.name': 'resumeai-pro-lwt',
        'telemetry.sdk.language': 'typescript',
        'cloudflare.worker': 'true',
      },
      spans: batch,
      timestamp: new Date().toISOString(),
    };
  }

  private async sendToApmEndpoint(batch: Span[]): Promise<void> {
    if (!this.options.exportEndpoint || !this.options.exportApiKey) return;

    try {
      await fetch(this.options.exportEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.options.exportApiKey}`,
        },
        body: JSON.stringify({
          resourceSpans: [{
            resource: {
              attributes: [{ key: 'service.name', value: { stringValue: this.options.serviceName } }],
            },
            scopeSpans: [{
              scope: { name: 'resumeai-pro' },
              spans: batch.map((s) => ({
                traceId: s.traceId,
                spanId: s.spanId,
                parentSpanId: s.parentSpanId ?? undefined,
                name: s.name,
                status: { code: s.status === 'error' ? 2 : 1 },
                startTimeUnixNano: BigInt(Math.round(s.startTime * 1_000_000)).toString(),
                endTimeUnixNano: BigInt(Math.round(s.endTime * 1_000_000)).toString(),
                attributes: Object.entries(s.attributes).map(([k, v]) => ({
                  key: k,
                  value: { stringValue: String(v) },
                })),
              })),
            }],
          }],
        }),
      });
    } catch {
      // Export is best-effort
    }
  }

  private generateId(length: number): string {
    const chars = 'abcdef0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
  }
}
