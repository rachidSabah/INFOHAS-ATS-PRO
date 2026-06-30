// ============================================================================
// Plugin SDK — Service Registry & Container Tests
// ============================================================================

import { describe, it, expect } from 'vitest';
import { ServiceContainer, ServiceRegistry, DependencyResolver } from '../index';

// ============================================================================
// ServiceContainer
// ============================================================================

describe('ServiceContainer', () => {
  it('binds and resolves a service', () => {
    const container = new ServiceContainer();
    container.bind('greeting', () => 'hello');
    expect(container.resolve<string>('greeting')).toBe('hello');
  });

  it('caches singleton by default', () => {
    const container = new ServiceContainer();
    let callCount = 0;
    container.bind('counter', () => {
      callCount++;
      return callCount;
    });
    expect(container.resolve<number>('counter')).toBe(1);
    expect(container.resolve<number>('counter')).toBe(1); // still 1
  });

  it('creates fresh instances when singleton=false', () => {
    const container = new ServiceContainer();
    let callCount = 0;
    container.bind('counter', () => {
      callCount++;
      return callCount;
    }, false);
    expect(container.resolve<number>('counter')).toBe(1);
    expect(container.resolve<number>('counter')).toBe(2); // fresh instance
  });

  it('throws on missing binding', () => {
    const container = new ServiceContainer();
    expect(() => container.resolve('nonexistent')).toThrow(/no binding/i);
  });

  it('has() checks binding existence', () => {
    const container = new ServiceContainer();
    container.bind('x', () => 42);
    expect(container.has('x')).toBe(true);
    expect(container.has('y')).toBe(false);
  });

  it('returns all tokens', () => {
    const container = new ServiceContainer();
    container.bind('a', () => 1);
    container.bind('b', () => 2);
    const tokens = container.getTokens();
    expect(tokens).toContain('a');
    expect(tokens).toContain('b');
  });

  it('createScope creates independent child', () => {
    const container = new ServiceContainer();
    container.bind('value', () => Math.random());
    const child = container.createScope();
    // Both parent and child resolve from their own factory
    expect(typeof child.resolve<number>('value')).toBe('number');
    expect(container.has('value')).toBe(true);
    expect(child.has('value')).toBe(true);
  });
});

// ============================================================================
// ServiceRegistry
// ============================================================================

describe('ServiceRegistry', () => {
  it('registers and resolves services', () => {
    const registry = new ServiceRegistry();
    registry.register('score', () => 95);
    expect(registry.resolve<number>('score')).toBe(95);
  });

  it('rejects duplicate bindings', () => {
    const registry = new ServiceRegistry();
    registry.register('key', () => 'first');
    expect(() => registry.register('key', () => 'second')).toThrow(/duplicate/i);
  });

  it('throws on missing token', () => {
    const registry = new ServiceRegistry();
    expect(() => registry.resolve('missing')).toThrow(/no binding/i);
  });

  it('getBinding returns metadata', () => {
    const registry = new ServiceRegistry();
    registry.register('x', () => 1, { tags: ['test'], description: 'test binding' });
    const binding = registry.getBinding('x');
    expect(binding).toBeDefined();
    expect(binding!.tags).toContain('test');
    expect(binding!.description).toBe('test binding');
  });

  it('createPluginScope only exposes allowed tokens', () => {
    const registry = new ServiceRegistry();
    registry.register('allowed', () => 'yes');
    registry.register('blocked', () => 'no');
    const scope = registry.createPluginScope('test-plugin', ['allowed']);
    expect(scope.resolve<string>('allowed')).toBe('yes');
    expect(() => scope.resolve('blocked')).toThrow();
  });
});

// ============================================================================
// DependencyResolver
// ============================================================================

describe('DependencyResolver', () => {
  it('resolves a simple chain', () => {
    const resolver = new DependencyResolver();
    resolver.registerDependencies('c', [{ id: 'b', versionRange: '*' }]);
    resolver.registerDependencies('b', [{ id: 'a', versionRange: '*' }]);
    resolver.registerDependencies('a', []);
    const order = resolver.resolve('c', new Set(['a', 'b', 'c']));
    expect(order).toEqual(['a', 'b', 'c']); // leaves first
  });

  it('throws on missing dependency', () => {
    const resolver = new DependencyResolver();
    resolver.registerDependencies('app', [{ id: 'missing', versionRange: '>=1.0' }]);
    expect(() => resolver.resolve('app', new Set(['app']))).toThrow(/missing/i);
  });

  it('throws on circular dependency', () => {
    const resolver = new DependencyResolver();
    resolver.registerDependencies('a', [{ id: 'b', versionRange: '*' }]);
    resolver.registerDependencies('b', [{ id: 'a', versionRange: '*' }]);
    expect(() => resolver.resolve('a', new Set(['a', 'b']))).toThrow(/circular/i);
  });

  it('buildGraph returns topological order with reverse edges', () => {
    const resolver = new DependencyResolver();
    resolver.registerDependencies('parser', [{ id: 'storage', versionRange: '*' }]);
    resolver.registerDependencies('guardian', [{ id: 'storage', versionRange: '*' }]);
    resolver.registerDependencies('supervisor', [
      { id: 'parser', versionRange: '*' },
      { id: 'guardian', versionRange: '*' },
    ]);
    resolver.registerDependencies('storage', []);

    const graph = resolver.buildGraph(new Set(['storage', 'parser', 'guardian', 'supervisor']));
    expect(graph.topologicalOrder).toContain('storage');
    // storage must come before its dependents
    const storageIdx = graph.topologicalOrder.indexOf('storage');
    const parserIdx = graph.topologicalOrder.indexOf('parser');
    const guardianIdx = graph.topologicalOrder.indexOf('guardian');
    expect(storageIdx).toBeLessThan(parserIdx);
    expect(storageIdx).toBeLessThan(guardianIdx);

    // Reverse edges (direct dependents only)
    const storageNode = graph.nodes.get('storage');
    expect(storageNode?.dependents).toContain('parser');
    expect(storageNode?.dependents).toContain('guardian');
    // supervisor is a transitive dependent, not direct
    expect(storageNode?.dependents).not.toContain('supervisor');
  });
});
