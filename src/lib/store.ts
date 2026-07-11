// ============================================================================
// ResumeAI Pro — Global Zustand Store (Slicing Implementation)
// ============================================================================

"use client";

import { create } from "zustand";
import { createAuthSlice, type AuthSlice } from "./store/auth-slice";
import { createResumesSlice, type ResumesSlice } from "./store/resumes-slice";
import { createAdminSlice, type AdminSlice } from "./store/admin-slice";
import { createDevWorkspaceSlice, type DevWorkspaceSlice } from "./store/dev-workspace-slice";

import { BRAND } from "./brand";
import { uid } from "./store/helpers";

export type AppState = AuthSlice & ResumesSlice & AdminSlice & DevWorkspaceSlice;

export const useApp = create<AppState>()((set, get, store) => ({
  ...createAuthSlice(set, get, store),
  ...createResumesSlice(set, get, store),
  ...createAdminSlice(set, get, store),
  ...createDevWorkspaceSlice(set, get, store),
}));

export { BRAND };
export { uid };

if (typeof window !== "undefined") {
  (window as any).useApp = useApp;
}
export default useApp;
