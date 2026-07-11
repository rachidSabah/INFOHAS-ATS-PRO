// ============================================================================
// Plugin SDK — Model Context Protocol (MCP) Adapter
// ============================================================================
// Adapts Model Context Protocol (MCP) tool schemas and JSON-RPC execution
// structures into the plugin system. Allows external tools to register
// as standard plugin capabilities.
// ============================================================================

"use client";

import type { Plugin } from "./interfaces/plugin";
import type { PluginManifest, HealthStatus } from "./types";
import type { ServiceContainer } from "./service-container";

export interface MCPToolSchema {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface MCPTool {
  schema: MCPToolSchema;
  handler: (args: Record<string, any>) => Promise<any>;
}

export class MCPAdapter implements Plugin {
  readonly id = "mcp.adapter";
  readonly manifest: PluginManifest = {
    id: "mcp.adapter",
    name: "Model Context Protocol Adapter",
    version: "1.0.0",
    author: "DeepMind",
    description: "Adapter bridging MCP tools to the Unified Career OS plugin system.",
    capabilities: ["tool_execution", "rpc_bridge"],
    dependencies: [],
    entry: "",
    configuration: { type: "object", properties: {} },
    permissions: ["network:fetch"],
  };

  private tools = new Map<string, MCPTool>();

  async initialize(ctx: ServiceContainer): Promise<void> {
    console.info("[MCPAdapter] Initialized and registered in ServiceContainer.");
  }

  async shutdown(): Promise<void> {
    this.tools.clear();
    console.info("[MCPAdapter] Shutdown complete.");
  }

  async healthCheck(): Promise<HealthStatus> {
    return "healthy";
  }

  /**
   * Register an MCP tool.
   */
  registerTool(tool: MCPTool): void {
    if (this.tools.has(tool.schema.name)) {
      throw new Error(`MCPAdapter: tool "${tool.schema.name}" already registered`);
    }
    this.tools.set(tool.schema.name, tool);
    console.info(`[MCPAdapter] Registered MCP tool: ${tool.schema.name}`);
  }

  /**
   * Get all registered MCP tool schemas.
   */
  getTools(): MCPToolSchema[] {
    return Array.from(this.tools.values()).map((t) => t.schema);
  }

  /**
   * Execute an MCP tool.
   */
  async callTool(name: string, args: Record<string, any>): Promise<any> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`MCPAdapter: tool "${name}" not found`);
    }
    
    try {
      // Validate args against schema properties
      const required = tool.schema.inputSchema.required || [];
      for (const req of required) {
        if (args[req] === undefined) {
          throw new Error(`MCPAdapter: missing required argument "${req}" for tool "${name}"`);
        }
      }

      return await tool.handler(args);
    } catch (err: any) {
      console.error(`[MCPAdapter] Error executing tool "${name}":`, err);
      throw new Error(`MCPAdapter execution error: ${err.message}`);
    }
  }
}
