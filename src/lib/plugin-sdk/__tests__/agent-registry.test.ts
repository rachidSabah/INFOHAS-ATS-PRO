// ============================================================================
// AgentRegistry Unit Tests
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRegistry } from '../agent-registry';
import type { AgentMetadata } from '../agent-registry';

describe('AgentRegistry', () => {
  beforeEach(() => {
    AgentRegistry.clear();
  });

  it('can register new agents and retrieve them', () => {
    const meta: AgentMetadata = {
      id: 'test-agent',
      name: 'Test Agent',
      description: 'A test agent',
      icon: 'Cpu',
      version: '1.0.0',
      capabilities: ['test_capability'],
    };

    AgentRegistry.register(meta);
    expect(AgentRegistry.has('test-agent')).toBe(true);
    expect(AgentRegistry.getAgent('test-agent')).toBe(meta);
  });

  it('throws on registering duplicate agent IDs', () => {
    const meta: AgentMetadata = {
      id: 'test-agent-duplicate',
      name: 'Test Agent',
      description: 'A test agent',
      icon: 'Cpu',
      version: '1.0.0',
      capabilities: ['test_capability'],
    };

    AgentRegistry.register(meta);
    expect(() => AgentRegistry.register(meta)).toThrow();
  });

  it('lists default agents if registry is empty', () => {
    const list = AgentRegistry.listAgents();
    expect(list.length).toBeGreaterThan(0);
    expect(AgentRegistry.has('supervisor')).toBe(true);
    expect(AgentRegistry.has('optimizer')).toBe(true);
  });
});
