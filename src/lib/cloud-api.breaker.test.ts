// Regression tests for the 5xx circuit breaker in cloud-api.
//
// INCIDENT (2026-09-08): GET /api/users returned 500 for every signed-in
// caller (D1 schema error — missing users.last_active_at column). Each call
// site was individually bounded, but the page kept re-invoking the sync on
// boot/admin mounts, producing an effectively unbounded request + console
// error storm. The breaker caps the RATE: after BREAKER_THRESHOLD 5xx
// attempts for the same method+path within the rolling window, calls fail
// fast (zero network) until the cooldown elapses.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api, __resetCircuitBreakerForTests } from "./cloud-api";

function jsonRes(status: number, body: any): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("5xx circuit breaker", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    __resetCircuitBreakerForTests();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("opens after repeated 5xx and then fails fast with ZERO network calls", async () => {
    fetchMock.mockImplementation(async () => jsonRes(500, { error: "db down" }));

    // Invocation 1: 3 attempts (2 internal backoffs: 1s + 2s) → caller sees
    // the mapped API error.
    const p1 = api.getUsers();
    const a1 = expect(p1).rejects.toThrow("db down");
    await vi.advanceTimersByTimeAsync(10_000);
    await a1;
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Invocation 2: the open-check runs once per invocation, so it completes
    // its full retry cycle — but its FIRST attempt is the 4th failure, which
    // trips the breaker. The caller still gets the real API error for THIS
    // invocation.
    const p2 = api.getUsers();
    const a2 = expect(p2).rejects.toThrow("db down");
    await vi.advanceTimersByTimeAsync(10_000);
    await a2;
    expect(fetchMock).toHaveBeenCalledTimes(6);

    // Invocation 3+: circuit open — fails fast, no network I/O at all.
    const a3 = expect(api.getUsers()).rejects.toThrow("temporarily unavailable");
    const a4 = expect(api.getUsers()).rejects.toThrow("temporarily unavailable");
    await vi.advanceTimersByTimeAsync(10_000);
    await a3;
    await a4;
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("a successful (< 500) response resets the failure counter", async () => {
    fetchMock.mockImplementation(async () => jsonRes(500, { error: "boom" }));

    // 3 failures — just below the threshold of 4.
    const p1 = api.getUsers();
    const a1 = expect(p1).rejects.toThrow("boom");
    await vi.advanceTimersByTimeAsync(10_000);
    await a1;
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // A 200 proves the server recovered — clears the failure history.
    fetchMock.mockImplementation(async () => jsonRes(200, { users: [] }));
    const p2 = api.getUsers();
    const a2 = expect(p2).resolves.toEqual({ users: [] });
    await vi.advanceTimersByTimeAsync(10_000);
    await a2;

    // 2 consecutive 5xx invocations after the reset: the first fully retried
    // invocation (3 attempts) must NOT open the circuit...
    fetchMock.mockImplementation(async () => jsonRes(500, { error: "boom" }));
    const p3 = api.getUsers();
    const a3 = expect(p3).rejects.toThrow("boom");
    await vi.advanceTimersByTimeAsync(10_000);
    await a3;
    expect(fetchMock).toHaveBeenCalledTimes(3 + 1 + 3);

    // ...the second invocation's first failed attempt (4th) does — that
    // invocation still completes its retry cycle and sees the real 500.
    const p4 = api.getUsers();
    const a4 = expect(p4).rejects.toThrow("boom");
    await vi.advanceTimersByTimeAsync(10_000);
    await a4;
    expect(fetchMock).toHaveBeenCalledTimes(3 + 1 + 3 + 3);

    // From here on: suppressed.
    const a5 = expect(api.getUsers()).rejects.toThrow("temporarily unavailable");
    await vi.advanceTimersByTimeAsync(10_000);
    await a5;
    expect(fetchMock).toHaveBeenCalledTimes(3 + 1 + 3 + 3);
  });

  it("the circuit re-closes after the cooldown and allows network again", async () => {
    fetchMock.mockImplementation(async () => jsonRes(500, { error: "boom" }));

    // Trip the breaker (4 failures = 3 attempts + 1).
    const p1 = api.getUsers();
    const a1 = expect(p1).rejects.toThrow("boom");
    await vi.advanceTimersByTimeAsync(10_000);
    await a1;
    const p2 = api.getUsers();
    const a2 = expect(p2).rejects.toThrow("boom");
    await vi.advanceTimersByTimeAsync(10_000);
    await a2;
    const a3 = expect(api.getUsers()).rejects.toThrow("temporarily unavailable");
    await vi.advanceTimersByTimeAsync(10_000);
    await a3;
    expect(fetchMock).toHaveBeenCalledTimes(6);

    // Cooldown elapses → next call goes back on the network.
    await vi.advanceTimersByTimeAsync(61_000);
    const p4 = api.getUsers();
    const a4 = expect(p4).rejects.toThrow("boom"); // server still broken
    await vi.advanceTimersByTimeAsync(10_000);
    await a4;
    expect(fetchMock).toHaveBeenCalledTimes(6 + 3);
  });

  it("circuits are per method+path — /api/users opening does not affect /api/resumes", async () => {
    fetchMock.mockImplementation(async () => jsonRes(500, { error: "boom" }));

    // Trip the breaker for GET /api/users (4 failures across 2 invocations).
    const p1 = api.getUsers();
    const a1 = expect(p1).rejects.toThrow("boom");
    await vi.advanceTimersByTimeAsync(10_000);
    await a1;
    const p2 = api.getUsers();
    const a2 = expect(p2).rejects.toThrow("boom");
    await vi.advanceTimersByTimeAsync(10_000);
    await a2;
    const a3 = expect(api.getUsers()).rejects.toThrow("temporarily unavailable");
    await vi.advanceTimersByTimeAsync(10_000);
    await a3;
    expect(fetchMock).toHaveBeenCalledTimes(6);

    // A different path still reaches the network.
    const callsBefore = fetchMock.mock.calls.length;
    const p3 = api.getResumes();
    const a4 = expect(p3).rejects.toThrow("boom");
    await vi.advanceTimersByTimeAsync(10_000);
    await a4;
    const resumeCalls = fetchMock.mock.calls.length - callsBefore;
    expect(resumeCalls).toBe(3); // its own full retry cycle
    expect(String(fetchMock.mock.calls[callsBefore][0])).toContain("/api/resumes");
  });

  it("4xx responses do NOT trip the breaker (server reachable, request bad)", async () => {
    fetchMock.mockImplementation(async () => jsonRes(404, { error: "nope" }));

    // Far more calls than the threshold — every one hits the network because
    // 4xx means the server is up and the circuit stays closed.
    for (let i = 0; i < 6; i++) {
      const p = api.getUsers();
      const a = expect(p).rejects.toThrow("nope");
      await vi.advanceTimersByTimeAsync(10_000);
      await a;
    }
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("network-level errors (TypeError) do NOT trip the breaker", async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });

    // CORS-style permanent failures retry once per invocation then give up;
    // they must never silently open the circuit and hide the real error.
    for (let i = 0; i < 3; i++) {
      const p = api.getUsers();
      const a = expect(p).rejects.toThrow("Cloud sync unavailable");
      await vi.advanceTimersByTimeAsync(10_000);
      await a;
    }
    // Every invocation retries all 3 attempts (250ms + 500ms backoff) —
    // network errors are recorded but never trip the breaker.
    expect(fetchMock).toHaveBeenCalledTimes(9);
  });
});
