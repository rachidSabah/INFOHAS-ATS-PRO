// ============================================================================
// MCPAdapter Unit Tests
// ============================================================================

import { describe, it, expect, vi } from 'vitest';
import { MCPAdapter } from '../mcp-adapter';
import type { MCPTool } from '../mcp-adapter';

describe('MCPAdapter', () => {
  it('can register tools and lists them', async () => {
    const adapter = new MCPAdapter();
    const mockHandler = vi.fn().mockResolvedValue('success');

    const tool: MCPTool = {
      schema: {
        name: 'test_tool',
        description: 'A test tool description',
        inputSchema: {
          type: 'object',
          properties: {
            arg1: { type: 'string' },
          },
          required: ['arg1'],
        },
      },
      handler: mockHandler,
    };

    adapter.registerTool(tool);

    const tools = adapter.getTools();
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe('test_tool');

    const result = await adapter.callTool('test_tool', { arg1: 'hello' });
    expect(result).toBe('success');
    expect(mockHandler).toHaveBeenCalledWith({ arg1: 'hello' });
  });

  it('validates required arguments when invoking a tool', async () => {
    const adapter = new MCPAdapter();
    const tool: MCPTool = {
      schema: {
        name: 'test_tool_validation',
        description: 'Description',
        inputSchema: {
          type: 'object',
          properties: {
            reqArg: { type: 'string' },
          },
          required: ['reqArg'],
        },
      },
      handler: async () => 'ok',
    };

    adapter.registerTool(tool);
    await expect(adapter.callTool('test_tool_validation', {})).rejects.toThrow();
  });
});
