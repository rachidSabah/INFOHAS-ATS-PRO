import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

// Disable edge runtime to use standard Node.js fs APIs
export const runtime = "nodejs";

const CONFIG_FILE = path.join(process.cwd(), ".mcp.json");

async function readConfig() {
  try {
    const data = await fs.readFile(CONFIG_FILE, "utf-8");
    return JSON.parse(data);
  } catch (err) {
    return { mcpServers: {} };
  }
}

async function writeConfig(config: any) {
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

export async function GET() {
  try {
    const config = await readConfig();
    return NextResponse.json(config);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as any;
    const { name, config } = body;
    if (!name || !config) {
      return NextResponse.json({ error: "Missing name or config" }, { status: 400 });
    }

    const currentConfig = await readConfig();
    if (!currentConfig.mcpServers) {
      currentConfig.mcpServers = {};
    }

    currentConfig.mcpServers[name] = config;
    await writeConfig(currentConfig);

    return NextResponse.json({ success: true, config: currentConfig });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const name = searchParams.get("name");
    if (!name) {
      return NextResponse.json({ error: "Missing name parameter" }, { status: 400 });
    }

    const currentConfig = await readConfig();
    if (currentConfig.mcpServers && currentConfig.mcpServers[name]) {
      delete currentConfig.mcpServers[name];
      await writeConfig(currentConfig);
    }

    return NextResponse.json({ success: true, config: currentConfig });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
