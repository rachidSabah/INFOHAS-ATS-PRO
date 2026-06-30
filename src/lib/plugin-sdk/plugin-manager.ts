// ============================================================================
// Plugin SDK — Plugin Manager (Phase 8, Step 3)
// ============================================================================
// Manages plugin lifecycle: discovery, registration, dependency resolution,
// version checking, capability detection, health monitoring.
//
// DISCOVERY ON CLOUDFLARE WORKERS:
// Workers cannot do filesystem globbing at runtime. Discovery is implemented
// as a build-time registry generation step (scripts/generate-plugin-registry.ts
// run during npm run build) that scans /plugins/**/manifest.ts, validates each
// against the manifest schema, and emits a generated file
// (plugin-registry.generated.ts) with static imports. Core never imports
// individual plugins — only the generated registry.
// ============================================================================

import type { PluginManifest, HealthStatus } from './types';
import type { Plugin } from './interfaces/plugin';
import type { ServiceContainer } from './service-container';
import type { EventBus } from './event-bus';

// ── Types ──────────────────────────────────────────────────────────────

export interface PluginRegistration {
  manifest: PluginManifest;
  instance: Plugin;
  status: 'inactive' | 'active' | 'error';
  error?: string;
}

/** A pair of [manifest, factory] as emitted by the generated registry. */
export type PluginRegistryEntry = [PluginManifest, () => Plugin];

// ============================================================================
// PluginManager
// ============================================================================

export class PluginManager {
  private plugins = new Map<string, PluginRegistration>();
  private container: ServiceContainer;
  private eventBus?: EventBus;
  private initialized = false;

  constructor(container: ServiceContainer, eventBus?: EventBus) {
    this.container = container;
    this.eventBus = eventBus;
  }

  // ── Initialization ───────────────────────────────────────────────────

  /**
   * Load all plugins from the generated registry.
   * Called once during app startup (buildContainer).
   * Each entry is a [manifest, factory] pair.
   */
  async loadFromRegistry(entries: PluginRegistryEntry[]): Promise<void> {
    for (const [manifest, factory] of entries) {
      await this.registerFromManifest(manifest, factory);
    }
    // Initialize in dependency order
    const order = this.topologicalSort();
    for (const id of order) {
      await this.initialize(id);
    }
    this.initialized = true;
  }

  /**
   * Register a plugin from its manifest + factory, without initializing.
   * The factory is NOT called until initialize() — deferred creation.
   */
  private async registerFromManifest(
    manifest: PluginManifest,
    factory: () => Plugin,
  ): Promise<void> {
    const id = manifest.id;
    if (this.plugins.has(id)) {
      throw new Error(`PluginManager: plugin "${id}" is already registered`);
    }

    // Store factory for later instantiation
    const instance = factory();
    this.plugins.set(id, {
      manifest: { ...manifest },
      instance,
      status: 'inactive',
    });

    this.eventBus?.emit({
      type: 'PluginLoaded',
      pluginId: id,
      version: manifest.version,
    });
  }

  // ── Registration ────────────────────────────────────────────────────

  /**
   * Register a plugin by its instance (for runtime-registered plugins).
   * Does NOT call initialize() — that's done separately.
   */
  async register(instance: Plugin): Promise<void> {
    const id = instance.id;
    if (this.plugins.has(id)) {
      throw new Error(`PluginManager: plugin "${id}" is already registered`);
    }
    this.plugins.set(id, {
      manifest: instance.manifest,
      instance,
      status: 'inactive',
    });
    this.eventBus?.emit({
      type: 'PluginLoaded',
      pluginId: id,
      version: instance.manifest.version,
    });
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  /**
   * Initialize a plugin: resolve dependencies, call initialize(), mark active.
   */
  async initialize(id: string): Promise<void> {
    const reg = this.plugins.get(id);
    if (!reg) throw new Error(`PluginManager: plugin "${id}" not found`);
    if (reg.status === 'active') return;

    // Resolve dependencies first
    await this.resolveDependencies(id);

    try {
      await reg.instance.initialize(this.container);
      reg.status = 'active';
    } catch (err) {
      reg.status = 'error';
      reg.error = err instanceof Error ? err.message : String(err);
      this.eventBus?.emit({
        type: 'PluginFailed',
        pluginId: id,
        error: reg.error,
      });
      throw err;
    }
  }

  /**
   * Shutdown a plugin: call shutdown(), mark inactive.
   */
  async shutdown(id: string): Promise<void> {
    const reg = this.plugins.get(id);
    if (!reg) return;
    try {
      await reg.instance.shutdown();
    } finally {
      reg.status = 'inactive';
    }
  }

  /**
   * Shutdown all plugins (used during app shutdown / hot reload).
   */
  async shutdownAll(): Promise<void> {
    const ids = Array.from(this.plugins.keys());
    for (const id of ids) {
      await this.shutdown(id);
    }
    this.plugins.clear();
    this.initialized = false;
  }

  // ── Health ───────────────────────────────────────────────────────────

  /**
   * Check plugin health.
   */
  async healthCheck(id: string): Promise<HealthStatus> {
    const reg = this.plugins.get(id);
    if (!reg) return 'unhealthy';
    if (reg.status === 'error') return 'unhealthy';
    try {
      return await reg.instance.healthCheck();
    } catch {
      return 'unhealthy';
    }
  }

  /**
   * Run health check on all active plugins.
   * Returns a map of pluginId -> healthStatus.
   */
  async healthCheckAll(): Promise<Map<string, HealthStatus>> {
    const results = new Map<string, HealthStatus>();
    const checks = Array.from(this.plugins.keys()).map(async (id) => {
      results.set(id, await this.healthCheck(id));
    });
    await Promise.all(checks);
    return results;
  }

  // ── Discovery ────────────────────────────────────────────────────────

  /**
   * Get all registered plugin manifests.
   */
  discover(): PluginManifest[] {
    const manifests: PluginManifest[] = [];
    this.plugins.forEach((reg) => {
      manifests.push(reg.manifest);
    });
    return manifests;
  }

  // ── Query ────────────────────────────────────────────────────────────

  /**
   * Get all plugin instances that match a capability.
   */
  getByCapability<T>(capability: string): T[] {
    const result: T[] = [];
    this.plugins.forEach((reg) => {
      if (reg.status === 'active' && reg.manifest.capabilities.includes(capability)) {
        result.push(reg.instance as unknown as T);
      }
    });
    return result;
  }

  /**
   * Get a specific plugin instance by ID.
   */
  get<T>(id: string): T | undefined {
    const reg = this.plugins.get(id);
    if (!reg || reg.status !== 'active') return undefined;
    return reg.instance as unknown as T;
  }

  /**
   * Get all registered plugins.
   */
  getAll(): PluginRegistration[] {
    const result: PluginRegistration[] = [];
    this.plugins.forEach((reg) => result.push(reg));
    return result;
  }

  /**
   * Check if the manager has been initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  // ── Dependency Resolution ────────────────────────────────────────────

  /**
   * Ensure all direct dependencies of a plugin are initialized.
   */
  private async resolveDependencies(id: string): Promise<void> {
    const reg = this.plugins.get(id);
    if (!reg) throw new Error(`PluginManager: plugin "${id}" not found`);

    for (const dep of reg.manifest.dependencies) {
      const depReg = this.plugins.get(dep.id);
      if (!depReg) {
        throw new Error(
          `PluginManager: missing dependency "${dep.id}" for plugin "${id}" (required: ${dep.versionRange})`,
        );
      }
      if (depReg.status !== 'active') {
        await this.initialize(dep.id);
      }
    }
  }

  /**
   * Compute topological initialization order using DFS.
   * Throws on circular dependencies.
   */
  private topologicalSort(): string[] {
    const visited = new Set<string>();
    const inProgress = new Set<string>();
    const order: string[] = [];

    const visit = (id: string) => {
      if (inProgress.has(id)) {
        throw new Error(
          `PluginManager: circular dependency detected involving plugin "${id}"`,
        );
      }
      if (visited.has(id)) return;

      inProgress.add(id);
      const reg = this.plugins.get(id);
      if (reg) {
        for (const dep of reg.manifest.dependencies) {
          visit(dep.id);
        }
      }
      inProgress.delete(id);
      visited.add(id);
      order.push(id);
    };

    const ids = Array.from(this.plugins.keys());
    for (const id of ids) {
      visit(id);
    }

    return order;
  }
}
