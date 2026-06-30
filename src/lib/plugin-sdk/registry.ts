// ============================================================================
// Plugin SDK — Service Registry & Dependency Resolver
// ============================================================================
// Handles plugin-to-plugin dependency graph resolution with topological sort,
// failing fast with descriptive errors on circular/missing dependencies.
// Part of Phase 8: Plugin SDK & Modularization.
// ============================================================================

import type { PluginDependency } from './types';

// ============================================================================
// Dependency Graph
// ============================================================================

export interface DependencyGraphNode {
  id: string;
  dependencies: string[];   // resolved dependency IDs
  dependents: string[];     // reverse edges — plugins that depend on this one
}

export interface DependencyGraph {
  nodes: Map<string, DependencyGraphNode>;
  topologicalOrder: string[];
}

// ============================================================================
// ServiceRegistry
// ============================================================================
// Holds bindings between interface tokens and their concrete implementations.
// The registry is populated during app initialization (buildContainer)
// and is read-only during request processing.
// ============================================================================

export interface ServiceBinding<T = unknown> {
  token: string;
  factory: () => T;
  singleton: boolean;
  tags?: string[];
  description?: string;
}

export class ServiceRegistry {
  private bindings = new Map<string, ServiceBinding>();
  private instances = new Map<string, unknown>();

  /**
   * Register a factory for a token.
   */
  register<T>(token: string, factory: () => T, options?: {
    singleton?: boolean;
    tags?: string[];
    description?: string;
  }): void {
    if (this.bindings.has(token)) {
      throw new Error(`ServiceRegistry: duplicate binding for token "${token}"`);
    }
    this.bindings.set(token, {
      token,
      factory,
      singleton: options?.singleton ?? true,
      tags: options?.tags,
      description: options?.description,
    });
  }

  /**
   * Resolve a service by token.
   * Returns the singleton instance if singleton=true (default), or calls
   * the factory each time if singleton=false.
   */
  resolve<T>(token: string): T {
    const binding = this.bindings.get(token);
    if (!binding) {
      throw new Error(`ServiceRegistry: no binding for token "${token}"`);
    }

    if (binding.singleton) {
      if (!this.instances.has(token)) {
        this.instances.set(token, binding.factory());
      }
      return this.instances.get(token) as T;
    }

    return binding.factory() as T;
  }

  /**
   * Check if a token has a registered binding.
   */
  has(token: string): boolean {
    return this.bindings.has(token);
  }

  /**
   * Get all registered tokens.
   */
  getTokens(): string[] {
    return Array.from(this.bindings.keys());
  }

  /**
   * Get binding metadata for a token.
   */
  getBinding(token: string): ServiceBinding | undefined {
    return this.bindings.get(token);
  }

  /**
   * Create a child registry (scoped to a plugin).
   * The child inherits all parent bindings but can override them.
   */
  createScope(): ServiceRegistry {
    const child = new ServiceRegistry();
    this.bindings.forEach((binding) => {
      // Re-register factory so scoped instances are separate
      child.register(binding.token, binding.factory, {
        singleton: binding.singleton,
        tags: binding.tags,
        description: binding.description,
      });
    });
    return child;
  }

  /**
   * Create a scoped registry for a specific plugin.
   * Only includes bindings whose tags include the plugin's allowed tags,
   * plus global bindings (no tags).
   */
  createPluginScope(pluginId: string, allowedTokens: string[]): ServiceRegistry {
    const child = new ServiceRegistry();
    for (const token of allowedTokens) {
      const binding = this.bindings.get(token);
      if (binding) {
        child.register(token, binding.factory, {
          singleton: false, // fresh instance per plugin scope
          tags: binding.tags,
          description: binding.description,
        });
      }
    }
    return child;
  }
}

// ============================================================================
// DependencyResolver
// ============================================================================
// Resolves a full dependency chain for a plugin (including transitive deps),
// sorted in topological order. Fails fast on circular or missing deps.
// ============================================================================

export class DependencyResolver {
  private dependencyMap = new Map<string, PluginDependency[]>();

  /**
   * Register a plugin's dependencies.
   */
  registerDependencies(pluginId: string, dependencies: PluginDependency[]): void {
    this.dependencyMap.set(pluginId, dependencies);
  }

  /**
   * Resolve the full transitive dependency chain for a plugin,
   * returned in topological order (leaves first).
   * Throws on circular or missing dependencies.
   */
  resolve(pluginId: string, available: Set<string>): string[] {
    const visited = new Set<string>();
    const inProgress = new Set<string>();
    const order: string[] = [];

    const visit = (id: string) => {
      if (inProgress.has(id)) {
        throw new Error(
          `DependencyResolver: circular dependency detected involving "${id}"`,
        );
      }
      if (visited.has(id)) return;

      inProgress.add(id);

      const deps = this.dependencyMap.get(id) || [];
      for (const dep of deps) {
        if (!available.has(dep.id)) {
          throw new Error(
            `DependencyResolver: missing dependency "${dep.id}" required by "${id}" (range: ${dep.versionRange})`,
          );
        }
        visit(dep.id);
      }

      inProgress.delete(id);
      visited.add(id);
      order.push(id);
    };

    visit(pluginId);
    return order;
  }

  /**
   * Build a full dependency graph from all registered dependencies.
   * Returns nodes with both "dependencies" and "dependents" (reverse edges)
   * plus a topological sort order.
   * Throws on circular dependencies.
   */
  buildGraph(
    available: Set<string> = new Set(this.dependencyMap.keys()),
  ): DependencyGraph {
    const nodes = new Map<string, DependencyGraphNode>();
    const visited = new Set<string>();
    const inProgress = new Set<string>();
    const topologicalOrder: string[] = [];
    const reverseEdges = new Map<string, Set<string>>();
    const resolvedDepsMap = new Map<string, string[]>();

    // Add reverse edge
    const addReverse = (dependent: string, dependency: string) => {
      if (!reverseEdges.has(dependency)) {
        reverseEdges.set(dependency, new Set());
      }
      reverseEdges.get(dependency)!.add(dependent);
    };

    const visit = (id: string) => {
      if (inProgress.has(id)) {
        throw new Error(
          `DependencyResolver: circular dependency detected involving "${id}"`,
        );
      }
      if (visited.has(id)) return;

      inProgress.add(id);

      const deps = this.dependencyMap.get(id) || [];
      const resolvedDeps: string[] = [];

      for (const dep of deps) {
        if (!available.has(dep.id)) {
          throw new Error(
            `DependencyResolver: missing dependency "${dep.id}" required by "${id}"`,
          );
        }
        addReverse(id, dep.id);
        resolvedDeps.push(dep.id);
        visit(dep.id);
      }

      inProgress.delete(id);
      visited.add(id);
      topologicalOrder.push(id);
      resolvedDepsMap.set(id, resolvedDeps);
    };

    // First pass: visit all available nodes to build reverse edges
    available.forEach((id) => visit(id));

    // Second pass: create all nodes with complete dependents
    available.forEach((id) => {
      const dependentsSet = reverseEdges.get(id);
      nodes.set(id, {
        id,
        dependencies: resolvedDepsMap.get(id) || [],
        dependents: dependentsSet ? Array.from(dependentsSet) : [],
      });
    });

    return { nodes, topologicalOrder };
  }
}
