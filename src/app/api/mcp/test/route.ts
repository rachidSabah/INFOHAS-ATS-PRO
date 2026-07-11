import { NextResponse } from "next/server";

export const runtime = "edge";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as any;
    const { url } = body;

    if (!url) {
      return NextResponse.json({ error: "Missing SSE URL" }, { status: 400 });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) {
      throw new Error(`Server returned HTTP ${res.status}`);
    }

    return NextResponse.json({
      success: true,
      message: "SSE connection reachable",
      tools: [
        {
          name: "sse_placeholder_tool",
          description: "A placeholder tool representing the SSE connection",
          inputSchema: { type: "object", properties: {} }
        }
      ]
    });
  } catch (err: any) {
    return NextResponse.json({ error: `Connection failed: ${err.message}` }, { status: 500 });
  }
}
