// ============================================================================
// Plugin SDK — Hook System
// ============================================================================
// Pipeline hooks allow plugins to intercept and annotate pipeline stages.
// Hooks may NOT modify the resume data content — only add metadata/annotations.
// Enforced by running completeness checks after every hook chain.
// Part of Phase 8: Plugin SDK & Modularization.
// ============================================================================

export type HookName =
  | 'beforeParse' | 'afterParse'
  | 'beforeOptimize' | 'afterOptimize'
  | 'beforeExport' | 'afterExport'
  | 'beforeProviderCall' | 'afterProviderCall'
  | 'beforeGuardian' | 'afterGuardian';

// ============================================================================
// HookSystem
// ============================================================================

export class HookSystem {
  private hooks = new Map<HookName, Array<{
    pluginId: string;
    handler: (ctx: unknown) => Promise<unknown>;
  }>>();

  /**
   * Register a hook handler.
   * Plugins register hooks during their initialize() phase.
   */
  register<T>(hook: HookName, pluginId: string, handler: (ctx: T) => Promise<T>): void {
    const existing = this.hooks.get(hook) || [];
    existing.push({
      pluginId,
      handler: handler as (ctx: unknown) => Promise<unknown>,
    });
    this.hooks.set(hook, existing);
  }

  /**
   * Unregister all hooks for a given plugin.
   * Called during plugin shutdown/hot-reload.
   */
  unregisterPlugin(pluginId: string): void {
    this.hooks.forEach((handlers, hookName) => {
      const remaining = handlers.filter((h) => h.pluginId !== pluginId);
      if (remaining.length === 0) {
        this.hooks.delete(hookName);
      } else {
        this.hooks.set(hookName, remaining);
      }
    });
  }

  /**
   * Run all handlers for a given hook in registration order.
   * Each handler can transform the context but should only add metadata.
   */
  async run<T>(hook: HookName, ctx: T): Promise<T> {
    const handlers = this.hooks.get(hook);
    if (!handlers || handlers.length === 0) return ctx;

    let currentCtx = ctx;
    for (const { pluginId, handler } of handlers) {
      try {
        currentCtx = await handler(currentCtx) as T;
      } catch (err) {
        console.error(`[HookSystem] Plugin "${pluginId}" failed on hook "${hook}":`, err);
        throw new Error(
          `Hook "${hook}" handler for plugin "${pluginId}" failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return currentCtx;
  }

  /**
   * Get registered hooks grouped by hook name (for introspection).
   */
  getRegisteredHooks(): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    this.hooks.forEach((handlers, hookName) => {
      result[hookName] = handlers.map((h) => h.pluginId);
    });
    return result;
  }
}
