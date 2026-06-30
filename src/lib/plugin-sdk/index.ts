// ============================================================================
// Plugin SDK — Barrel Exports
// ============================================================================
// Single entry point for all Phase 8 Plugin SDK exports.
// ============================================================================

// Types (pure data, no runtime)
export type * from './types';

// Interfaces
export type { IAIProvider, IAgent, IExporter, ITemplate, IIndustryEngine } from './interfaces/core';
export type { IATSProvider, IGuardian, IParser, ISectionRenderer, IAuthenticationProvider, IStorageProvider } from './interfaces/core';
export type { Plugin, PluginLifecycle } from './interfaces/plugin';
export type { ProviderPlugin, AgentPlugin, ExportPlugin, TemplatePlugin, IndustryPlugin } from './interfaces/plugin';
export type { ATSPlugin, GuardianPlugin, ParserPlugin, AuthPlugin, StoragePlugin } from './interfaces/plugin';

// Runtime
export { ServiceContainer, buildContainer } from './service-container';
export { ServiceRegistry, DependencyResolver } from './registry';
export type { ServiceBinding, DependencyGraph, DependencyGraphNode } from './registry';
export { PluginManager } from './plugin-manager';
export type { PluginRegistration } from './plugin-manager';
export { EventBus } from './event-bus';
export type { EventHandler } from './event-bus';
export { HookSystem } from './hook-system';
export type { HookName } from './hook-system';
