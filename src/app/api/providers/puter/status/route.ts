// ResumeAI Pro — Puter Provider Status API
// Returns current Puter authentication status.
// Edge Runtime compatible.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function GET(_req: NextRequest) {
  // Status is managed client-side via the PuterProvider singleton.
  // This endpoint provides the expected API shape for the status check.
  // The client-side provider reads from localStorage + Puter.js state.
  return NextResponse.json({
    connected: false,
    authenticated: false,
    email: null,
    expiresAt: null,
    models: [],
    sharedAdminAccount: false,
    message: "Puter authentication is managed client-side. Check provider status from the UI.",
  });
}
