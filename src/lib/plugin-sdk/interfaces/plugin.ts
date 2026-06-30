// ============================================================================
// Plugin SDK — Plugin Base Interface
// ============================================================================
// Every plugin (Provider, Agent, Export, Industry, Template, etc.) implements
// this base interface. The PluginManager discovers, initializes, and manages
// lifecycle for all plugins through this contract.
// ============================================================================

import type { PluginManifest, HealthStatus } from '../types';
import type { ServiceContainer } from '../service-container';
import type {
  IAIProvider, IAgent, IExporter, ITemplate, IIndustryEngine,
  IATSProvider, IGuardian, IParser, IAuthenticationProvider, IStorageProvider,
} from './core';

// ============================================================================
// Base Plugin Interface
// ============================================================================

export interface Plugin {
  /** Unique plugin identifier from manifest (e.g. "provider.anthropic-claude") */
  readonly id: string;

  /** Parsed manifest metadata */
  readonly manifest: PluginManifest;

  /** Called once during registration to validate the plugin can load */
  initialize(ctx: ServiceContainer): Promise<void>;

  /** Called during graceful shutdown / hot reload */
  shutdown(): Promise<void>;

  /** Return current health status */
  healthCheck(): Promise<HealthStatus>;
}

// ============================================================================
// Plugin Lifecycle Hooks (optional per-plugin extensions)
// ============================================================================

export interface PluginLifecycle {
  onLoad?: (ctx: ServiceContainer) => Promise<void>;
  onUnload?: () => Promise<void>;
  onConfigChange?: (oldConfig: unknown, newConfig: unknown) => Promise<void>;
}

// ============================================================================
// Compound Plugin Types
// ============================================================================
// These are intersection types combining Plugin with capability interfaces.
// A class can implement Plugin directly plus any capability interface.
// These compound types are convenience aliases for the PluginManager registry.

/** Plugin that provides AI model access (e.g. Claude, GPT-4) */
export type ProviderPlugin = Plugin & IAIProvider;

/** Plugin that performs a pipeline stage (e.g. Supervisor, Parser) */
export type AgentPlugin = Plugin & IAgent;

/** Plugin that renders resume data to a specific output format */
export type ExportPlugin = Plugin & IExporter;

/** Plugin that provides a resume template layout */
export type TemplatePlugin = Plugin & ITemplate;

/** Plugin that provides industry-specific vocabulary and knowledge */
export type IndustryPlugin = Plugin & IIndustryEngine;

/** Plugin that provides ATS scoring */
export type ATSPlugin = Plugin & IATSProvider;

/** Plugin that validates optimized output against source */
export type GuardianPlugin = Plugin & IGuardian;

/** Plugin that parses raw resume text into structured data */
export type ParserPlugin = Plugin & IParser;

/** Plugin that handles authentication */
export type AuthPlugin = Plugin & IAuthenticationProvider;

/** Plugin that provides scoped storage access */
export type StoragePlugin = Plugin & IStorageProvider;
