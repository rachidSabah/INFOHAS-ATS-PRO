import { NextResponse } from "next/server";

export const runtime = "edge";

let configStore: { mcpServers: Record<string, any> } = { mcpServers: {} };

function readConfig() {
  return configStore;
}

function writeConfig(config: any) {
  configStore = config;
}

export async function GET() {
  try {
    return NextResponse.json(readConfig());
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

    const currentConfig = readConfig();
    if (!currentConfig.mcpServers) {
      currentConfig.mcpServers = {};
    }

    currentConfig.mcpServers[name] = config;
    writeConfig(currentConfig);

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

    const currentConfig = readConfig();
    if (currentConfig.mcpServers && currentConfig.mcpServers[name]) {
      delete currentConfig.mcpServers[name];
      writeConfig(currentConfig);
    }

    return NextResponse.json({ success: true, config: currentConfig });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
