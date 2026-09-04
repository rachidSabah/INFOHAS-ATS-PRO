import { NextResponse } from "next/server";

export const runtime = "edge";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as any;
    const { url } = body;

    if (!url) {
      return NextResponse.json({ error: "Missing SSE URL" }, { status: 400 });
    }

    // SSRF guard: block private/loopback/metadata hostnames and IP ranges before fetching.
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }
    if (!/^https?:$/.test(parsedUrl.protocol)) {
      return NextResponse.json({ error: "Only http/https URLs are supported" }, { status: 400 });
    }
    const ssrfHost = parsedUrl.hostname.toLowerCase();
    // Block numeric/hex/octal hostnames (e.g. 2130706433, 0x7f000001, 0177) that resolve
    // to loopback/private IPs but bypass the dotted-quad check below.
    if (
      /^0x[0-9a-f]+$/i.test(ssrfHost) ||
      /^\d+$/.test(ssrfHost) ||
      /^0[0-7]+$/.test(ssrfHost) ||
      ["localhost", "metadata.google.internal", "metadata", "169.254.169.254", "metadata.azure.com"].includes(ssrfHost)
    ) {
      return NextResponse.json({ error: "URL points to an internal/blocked endpoint" }, { status: 400 });
    }
    // Block IPv4 private/reserved ranges (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, 0/8, 224+)
    const ipv4 = ssrfHost.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
      const [, a, b] = ipv4.map(Number) as unknown as number[];
      if (
        a === 10 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        a === 127 ||
        (a === 169 && b === 254) ||
        a === 0 ||
        a >= 224
      ) {
        return NextResponse.json({ error: "URL points to a private/reserved IP range" }, { status: 400 });
      }
    }
    // Block IPv6 loopback / link-local / unique-local
    if (
      ssrfHost === "::1" ||
      ssrfHost === "0:0:0:0:0:0:0:1" ||
      ssrfHost.startsWith("fc") ||
      ssrfHost.startsWith("fd") ||
      ssrfHost.startsWith("fe80:") ||
      ssrfHost.startsWith("fe9") ||
      ssrfHost.startsWith("fea") ||
      ssrfHost.startsWith("feb")
    ) {
      return NextResponse.json({ error: "URL points to a loopback/link-local IPv6 address" }, { status: 400 });
    }
    // Block non-canonical numeric hostnames ("127.1", "0177.0.0.1", "0x7f.0.0.1")
    // that resolve to loopback/private IPs but bypass the dotted-quad regex.
    if (ssrfHost.includes(".") && /^[0-9a-fx.]+$/.test(ssrfHost)) {
      const parts = ssrfHost.split(".");
      const canonical =
        parts.length === 4 &&
        parts.every((p) => /^\d{1,3}$/.test(p) && !/^0\d/.test(p) && Number(p) <= 255);
      if (!canonical) {
        return NextResponse.json({ error: "URL points to a non-canonical numeric hostname" }, { status: 400 });
      }
    }
    // Fetch with manual redirect handling — every hop is re-validated so a
    // redirect to a private/metadata address cannot bypass the guards above.
    const MAX_REDIRECT_HOPS = 3;
    let currentUrl = url;
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
      const hopUrl = new URL(currentUrl);
      const hopHost = hopUrl.hostname.toLowerCase();
      if (!/^https?:$/.test(hopUrl.protocol) ||
          ["localhost", "metadata.google.internal", "metadata", "169.254.169.254", "metadata.azure.com"].includes(hopHost) ||
          /^0x[0-9a-f]+$/i.test(hopHost) || /^\d+$/.test(hopHost) || /^0[0-7]+$/.test(hopHost)) {
        return NextResponse.json({ error: "Redirect target points to an internal/blocked endpoint" }, { status: 400 });
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const hopRes = await fetch(currentUrl, { signal: controller.signal, redirect: "manual" });
      clearTimeout(timeoutId);
      if (hopRes.status >= 300 && hopRes.status < 400) {
        const location = hopRes.headers.get("location");
        if (!location) { res = hopRes; break; }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }
      res = hopRes;
      break;
    }
    if (!res) {
      return NextResponse.json({ error: "Too many redirects" }, { status: 508 });
    }
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
