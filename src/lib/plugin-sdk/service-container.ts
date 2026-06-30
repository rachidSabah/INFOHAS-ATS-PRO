// ============================================================================
// Plugin SDK — Service Container (Phase 8, Step 2)
// ============================================================================
// Lightweight dependency injection container. Fresh instance per Worker request.
// Bind once per Worker fetch() invocation, pulling D1/KV bindings from env.
// ============================================================================

import { ServiceRegistry } from './registry';

export class ServiceContainer {
  private registry: ServiceRegistry;

  constructor(registry?: ServiceRegistry) {
    this.registry = registry ?? new ServiceRegistry();
  }

  /**
   * Bind a factory for a token.
   * The factory is called lazily on first resolve().
   * By default, the factory is called once and the result is cached (singleton).
   */
  bind<T>(token: string, factory: () => T, singleton: boolean = true): this {
    this.registry.register(token, factory, { singleton });
    return this;
  }

  /**
   * Resolve a bound service by token.
   * Throws if token is not bound — no silent fallback.
   */
  resolve<T>(token: string): T {
    return this.registry.resolve<T>(token);
  }

  /**
   * Check if a token has been bound (without resolving).
   */
  has(token: string): boolean {
    return this.registry.has(token);
  }

  /**
   * Get all registered token names.
   */
  getTokens(): string[] {
    return this.registry.getTokens();
  }

  /**
   * Create a child container with the same bindings as this one.
   * Used by PluginManager to give each plugin a scoped container.
   */
  createScope(): ServiceContainer {
    return new ServiceContainer(this.registry.createScope());
  }

  /**
   * Create a scoped container for a specific plugin.
   * Only bindings matching the plugin's declared permissions are exposed.
   */
  createPluginScope(pluginId: string, allowedTokens: string[]): ServiceContainer {
    return new ServiceContainer(
      this.registry.createPluginScope(pluginId, allowedTokens),
    );
  }
}

// ============================================================================
// Build Container (convenience factory)
// ============================================================================
// In a Cloudflare Worker fetch() handler:
//   const container = buildContainer(env);
//   const pluginManager = container.resolve<PluginManager>('pluginManager');
// ============================================================================

/**
 * Build a fully-configured ServiceContainer from a Cloudflare Worker's env bindings.
 * This is the standard entry point for request-scoped container initialization.
 * Concrete implementations (D1StorageProvider, KVStorageProvider, etc.) are
 * bound here — consumers use IStorageProvider interface, never concrete imports.
 */
export function buildContainer(env: Record<string, unknown>): ServiceContainer {
  const container = new ServiceContainer();

  // Bind storage providers
  container.bind('env', () => env);

  // D1 Storage
  if (env.DB) {
    // container.bind<IStorageProvider>('storage.d1', () => new D1StorageProvider(env.DB));
    // Will be uncommented when D1StorageProvider implements IStorageProvider
  }

  // KV Storage
  if (env.CACHE) {
    // container.bind<IStorageProvider>('storage.kv', () => new KVStorageProvider(env.CACHE));
    // Will be uncommented when KVStorageProvider implements IStorageProvider
  }

  // Event bus (shared instance per request)
  // container.bind('eventBus', () => new EventBus());

  // Plugin manager
  // container.bind('pluginManager', () => new PluginManager(
  //   container.resolve<EventBus>('eventBus'),
  // ));

  return container;
}
