// ============================================================================
// Zustand Store — Flight Recorder (in-session, client-side) Slice
//
// Phase 8.1.5 (P4 — Flight Recorder Console). The Enterprise Flight
// Recorder emits structured `FlightRecord`s but delegates persistence to
// whoever registers an `AfterPersist` hook. There is no server store, so
// this slice is the in-session read-model: a capped ring buffer of
// records captured during the current browser session, queried with the
// existing pure `matchesFlightFilter` helper. This mirrors the IndexedDB-
// local pattern used for interview recordings — privacy-friendly, offline,
// no backend surface.
// ============================================================================

"use client";

import type { StateCreator } from "zustand";
import type { AppState } from "../store";
import type { FlightRecord } from "../ai/flight-recorder";

/** Ring-buffer cap (matches the recorder's documented log ring). */
export const FLIGHT_LOG_CAP = 500;

export interface FlightSlice {
  /** In-session captured executions (newest first). */
  flightRecords: FlightRecord[];

  pushFlightRecord: (r: FlightRecord) => void;
  /** Replace the whole log (used by the AfterPersist sink batch). */
  setFlightRecords: (rs: FlightRecord[]) => void;
  clearFlightLog: () => void;
  /** Count of records captured this session. */
  flightLogSize: () => number;
}

export const createFlightSlice: StateCreator<AppState, [], [], FlightSlice> = (set, get) => {
  const cap = (rs: FlightRecord[]): FlightRecord[] =>
    rs.length > FLIGHT_LOG_CAP ? rs.slice(0, FLIGHT_LOG_CAP) : rs;

  return {
    flightRecords: [],

    pushFlightRecord: (r) =>
      set((s) => ({ flightRecords: cap([r, ...s.flightRecords]) })),

    setFlightRecords: (rs) => set({ flightRecords: cap([...rs]) }),

    clearFlightLog: () => set({ flightRecords: [] }),

    flightLogSize: () => get().flightRecords.length,
  };
}
