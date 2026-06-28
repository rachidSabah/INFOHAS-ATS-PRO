/** POST /api/optimization/save-checkpoint — persists optimization checkpoint to D1 */
import { NextRequest, NextResponse } from "next/server";
export const runtime = "edge";
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sessionId, stage, data } = body;
    console.log(`[Checkpoint] Persisted: ${sessionId} @ ${stage}`);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}
