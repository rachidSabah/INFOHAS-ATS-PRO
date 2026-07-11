import { NextResponse } from "next/server";
import { spawn } from "child_process";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as any;
    const { type, command, args, url, env } = body;

    if (type === "sse") {
      if (!url) {
        return NextResponse.json({ error: "Missing SSE URL" }, { status: 400 });
      }
      // Test SSE HTTP handshake
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok) {
          throw new Error(`Server returned HTTP ${res.status}`);
        }
        // Since SSE is a long-lived stream, getting a 200 OK or similar means it is reachable
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
        return NextResponse.json({ error: `SSE connection failed: ${err.message}` }, { status: 500 });
      }
    } else {
      // Stdio command
      if (!command) {
        return NextResponse.json({ error: "Missing command" }, { status: 400 });
      }

      return new Promise((resolve) => {
        const cleanArgs = args || [];
        const envVars = { ...process.env, ...(env || {}) };

        // Use shell: true on Windows to resolve npm/npx paths correctly
        const isWin = process.platform === "win32";
        const child = spawn(command, cleanArgs, {
          shell: isWin,
          env: envVars,
          stdio: ["pipe", "pipe", "pipe"],
        });

        let stdoutData = "";
        let stderrData = "";
        let resolved = false;

        const timer = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            child.kill();
            resolve(
              NextResponse.json(
                { error: "Timeout waiting for MCP handshake (5s)", stderr: stderrData },
                { status: 500 }
              )
            );
          }
        }, 5000);

        child.stdout.on("data", (data) => {
          stdoutData += data.toString();
          
          // Try to parse JSON-RPC messages from stdout
          // Stdio MCP writes JSON lines or individual JSON objects
          try {
            // Find JSON-RPC objects
            const lines = stdoutData.split("\n");
            for (const line of lines) {
              if (line.trim().startsWith("{")) {
                const msg = JSON.parse(line.trim());
                // Handle initialize response or tools list response
                if (msg.result && (msg.id === 1 || msg.id === "init")) {
                  // Handshake succeeded, now ask for tools
                  const getToolsRequest = JSON.stringify({
                    jsonrpc: "2.0",
                    id: 2,
                    method: "tools/list",
                    params: {},
                  }) + "\n";
                  child.stdin.write(getToolsRequest);
                } else if (msg.result && msg.result.tools && (msg.id === 2 || msg.id === "tools")) {
                  // Received tools list!
                  if (!resolved) {
                    resolved = true;
                    clearTimeout(timer);
                    child.kill();
                    resolve(NextResponse.json({ success: true, tools: msg.result.tools }));
                  }
                }
              }
            }
          } catch (e) {
            // Ignore incomplete JSON chunks
          }
        });

        child.stderr.on("data", (data) => {
          stderrData += data.toString();
        });

        child.on("error", (err) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            resolve(NextResponse.json({ error: `Failed to start process: ${err.message}`, stderr: stderrData }, { status: 500 }));
          }
        });

        child.on("exit", (code) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            // If it exited early, check if we got tools anyway or return error
            resolve(
              NextResponse.json(
                { error: `Process exited prematurely with code ${code}`, stderr: stderrData, stdout: stdoutData },
                { status: 500 }
              )
            );
          }
        });

        // Write initialize request to start the handshake
        const initRequest = JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "resumeai-pro", version: "1.0.0" },
          },
        }) + "\n";
        child.stdin.write(initRequest);
      });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
