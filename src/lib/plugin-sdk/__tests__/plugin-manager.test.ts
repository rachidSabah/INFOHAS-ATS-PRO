// ============================================================================
// Plugin SDK — Plugin Manager Tests
// ============================================================================

import { describe, it, expect, vi } from 'vitest';
import { PluginManager, ServiceContainer, EventBus } from '../index';
import type { Plugin, PluginManifest, HealthStatus } from '../index';

// ── Test Fixture ───────────────────────────────────────────────────────

function createMockPlugin(
  id: string,
  deps: Array<{ id: string; versionRange: string }> = [],
  capabilities: string[] = [],
): Plugin {
  return {
    id,
    manifest: {
      id,
      name: `Test ${id}`,
      version: '1.0.0',
      author: 'test',
      description: 'Test plugin',
      capabilities,
      dependencies: deps,
      entry: './index.ts',
      configuration: { type: 'object', properties: {} },
      permissions: [],
    },
    initialize: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue('healthy' as HealthStatus),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('PluginManager', () => {
  // ── Registration ─────────────────────────────────────────────────────

  it('registers a plugin instance', async () => {
    const pm = new PluginManager(new ServiceContainer());
    const plugin = createMockPlugin('test.foo');
    await pm.register(plugin);
    expect(pm.getAll()).toHaveLength(1);
    // get() requires active status; check via getAll()
    const regs = pm.getAll();
    expect(regs[0].instance).toBe(plugin);
    expect(regs[0].status).toBe('inactive');
  });

  it('rejects duplicate registration', async () => {
    const pm = new PluginManager(new ServiceContainer());
    await pm.register(createMockPlugin('test.dup'));
    await expect(pm.register(createMockPlugin('test.dup'))).rejects.toThrow(/already registered/i);
  });

  // ── Registry Loading ─────────────────────────────────────────────────

  it('loads plugins from registry entries', async () => {
    const pm = new PluginManager(new ServiceContainer());
    const plugin = createMockPlugin('test.from-registry');
    await pm.loadFromRegistry([[plugin.manifest, () => plugin]]);
    expect(pm.get('test.from-registry')).toBe(plugin);
    expect(plugin.initialize).toHaveBeenCalledTimes(1);
  });

  it('initializes plugins in dependency order', async () => {
    const pm = new PluginManager(new ServiceContainer());
    const order: string[] = [];

    const base = createMockPlugin('base');
    const origInit1 = base.initialize;
    base.initialize = vi.fn().mockImplementation(async () => {
      order.push('base');
      await origInit1(new ServiceContainer());
    });

    const dep = createMockPlugin('dependent', [{ id: 'base', versionRange: '>=1.0' }]);
    const origInit2 = dep.initialize;
    dep.initialize = vi.fn().mockImplementation(async () => {
      order.push('dependent');
      await origInit2(new ServiceContainer());
    });

    await pm.loadFromRegistry([
      [base.manifest, () => base],
      [dep.manifest, () => dep],
    ]);

    expect(order).toEqual(['base', 'dependent']);
  });

  it('rejects circular dependencies', async () => {
    const pm = new PluginManager(new ServiceContainer());
    const a = createMockPlugin('a', [{ id: 'b', versionRange: '*' }]);
    const b = createMockPlugin('b', [{ id: 'a', versionRange: '*' }]);
    await expect(
      pm.loadFromRegistry([
        [a.manifest, () => a],
        [b.manifest, () => b],
      ]),
    ).rejects.toThrow(/circular/i);
  });

  // ── Lifecycle ────────────────────────────────────────────────────────

  it('initialize calls plugin.initialize', async () => {
    const pm = new PluginManager(new ServiceContainer());
    const plugin = createMockPlugin('test.lifecycle');
    await pm.register(plugin);
    await pm.initialize('test.lifecycle');
    expect(plugin.initialize).toHaveBeenCalledTimes(1);
  });

  it('shutdown calls plugin.shutdown', async () => {
    const pm = new PluginManager(new ServiceContainer());
    const plugin = createMockPlugin('test.shutdown');
    await pm.register(plugin);
    await pm.initialize('test.shutdown');
    await pm.shutdown('test.shutdown');
    expect(plugin.shutdown).toHaveBeenCalledTimes(1);
  });

  it('shutdownAll clears all plugins', async () => {
    const pm = new PluginManager(new ServiceContainer());
    await pm.register(createMockPlugin('test.a'));
    await pm.register(createMockPlugin('test.b'));
    await pm.shutdownAll();
    expect(pm.getAll()).toHaveLength(0);
  });

  // ── Health ───────────────────────────────────────────────────────────

  it('healthCheck returns healthy for active plugin', async () => {
    const pm = new PluginManager(new ServiceContainer());
    const plugin = createMockPlugin('test.health');
    await pm.register(plugin);
    await pm.initialize('test.health');
    const status = await pm.healthCheck('test.health');
    expect(status).toBe('healthy');
  });

  it('healthCheck returns unhealthy for unregistered plugin', async () => {
    const pm = new PluginManager(new ServiceContainer());
    const status = await pm.healthCheck('missing');
    expect(status).toBe('unhealthy');
  });

  // ── Capability Queries ───────────────────────────────────────────────

  it('getByCapability returns matching plugins', async () => {
    const pm = new PluginManager(new ServiceContainer());
    const p1 = createMockPlugin('test.provider1', [], ['reasoning']);
    const p2 = createMockPlugin('test.provider2', [], ['vision']);
    const p3 = createMockPlugin('test.provider3', [], ['reasoning', 'json']);
    await pm.loadFromRegistry([
      [p1.manifest, () => p1],
      [p2.manifest, () => p2],
      [p3.manifest, () => p3],
    ]);
    const reasoning = pm.getByCapability<Plugin>('reasoning');
    expect(reasoning).toHaveLength(2);
  });

  // ── Event Bus Integration ────────────────────────────────────────────

  it('emits PluginLoaded event on registration', async () => {
    const events: unknown[] = [];
    const bus = new EventBus();
    bus.on('PluginLoaded', (e) => { events.push(e); });
    const pm = new PluginManager(new ServiceContainer(), bus);
    await pm.register(createMockPlugin('test.event'));
    expect(events).toHaveLength(1);
  });

  // ── Discovery ────────────────────────────────────────────────────────

  it('discover returns all manifests', async () => {
    const pm = new PluginManager(new ServiceContainer());
    await pm.register(createMockPlugin('test.d1'));
    await pm.register(createMockPlugin('test.d2'));
    const manifests = pm.discover();
    expect(manifests).toHaveLength(2);
  });
});
