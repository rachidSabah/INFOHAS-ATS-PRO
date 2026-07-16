// ============================================================================
// ResumeAI Pro — Global Zustand Store (Slicing Implementation)
// ============================================================================

"use client";

import { create } from "zustand";
import { createAuthSlice, type AuthSlice } from "./store/auth-slice";
import { createResumesSlice, type ResumesSlice } from "./store/resumes-slice";
import { createAdminSlice, type AdminSlice } from "./store/admin-slice";
import { createDevWorkspaceSlice, type DevWorkspaceSlice } from "./store/dev-workspace-slice";
import { createFlightSlice, type FlightSlice } from "./store/flight-slice";
import { registerHook } from "./ai/hooks";

import { BRAND } from "./brand";
import { uid } from "./store/helpers";

export type AppState = AuthSlice & ResumesSlice & AdminSlice & DevWorkspaceSlice & FlightSlice;

export const useApp = create<AppState>()((set, get, store) => ({
  ...createAuthSlice(set, get, store),
  ...createResumesSlice(set, get, store),
  ...createAdminSlice(set, get, store),
  ...createDevWorkspaceSlice(set, get, store),
  ...createFlightSlice(set, get, store),
}));

// ----------------------------------------------------------------------------
// Phase 8.1.5 (P4) — Flight Recorder Console sink.
// Persist every emitted FlightRecord into the in-session client log so the
// console can list/replay executions. No-op when the recorder is disabled.
// Registered once at module load (singleton). The hook reads `ctx.result`,
// which is the finalized FlightRecord on AfterPersist.
// ----------------------------------------------------------------------------
if (typeof window !== "undefined") {
  registerHook("AfterPersist", (ctx) => {
    const record = ctx.result as AppState["flightRecords"][number] | undefined;
    if (record && typeof record === "object") {
      useApp.getState().pushFlightRecord(record);
    }
  });
}

export { BRAND };
export { uid };

if (typeof window !== "undefined") {
  (window as any).useApp = useApp;
}
export default useApp;
