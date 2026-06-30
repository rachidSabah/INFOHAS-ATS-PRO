// ============================================================================
// Cloudflare Bindings — Type Definitions
// ============================================================================
// Loosely typed for cross-environment compatibility (worker vs client).
// Follows the existing pattern in antigravity-routes.ts and task-manager.ts.
// ============================================================================

/** Cloudflare KV namespace — typed interface for cache operations */
export interface KVNamespace {
  get(key: string, options?: { type?: 'text' | 'json' | 'arrayBuffer' | 'stream' }): Promise<string | null | ArrayBuffer | ReadableStream>;
  put(key: string, value: string | ArrayBuffer | ReadableStream, options?: { expirationTtl?: number; expiration?: number; metadata?: unknown }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{ keys: Array<{ name: string; expiration?: number; metadata?: unknown }>; list_complete: boolean; cursor: string }>;
  getWithMetadata<T = unknown>(key: string, options?: { type?: 'text' | 'json' | 'arrayBuffer' | 'stream' }): Promise<{ value: string | null | ArrayBuffer | ReadableStream | null; metadata?: T }>;
}

/** Cloudflare D1 database — typed interface for query operations */
export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  dump(): Promise<ArrayBuffer>;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
  exec(sql: string): Promise<D1Result>;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(col?: string): Promise<T | null>;
  run(): Promise<D1Result>;
  all<T = unknown>(): Promise<D1Result & { results: T[] }>;
  raw(): Promise<unknown[][]>;
}

export interface D1Result {
  success: boolean;
  meta: {
    duration: number;
    changes?: number;
    last_row_id?: number;
    served_by?: string;
    rows_read?: number;
    rows_written?: number;
  };
  error?: string;
}

/** Cloudflare R2 bucket — typed interface for object storage */
export interface R2Bucket {
  put(key: string, value: ReadableStream | ArrayBuffer | string, options?: R2PutOptions): Promise<R2Object>;
  get(key: string, options?: R2GetOptions): Promise<R2ObjectBody | null>;
  delete(keys: string[]): Promise<void>;
  head(key: string): Promise<R2Object | null>;
  list(options?: R2ListOptions): Promise<R2Objects>;
}

export interface R2PutOptions {
  httpMetadata?: Record<string, string>;
  customMetadata?: Record<string, string>;
  onlyIf?: R2Conditional;
}

export interface R2GetOptions {
  onlyIf?: R2Conditional;
  range?: { offset: number; length: number } | { suffix: number };
}

export interface R2Conditional {
  etadMatches?: string;
  etadNotMatches?: string;
  uploadedBefore?: Date;
  uploadedAfter?: Date;
}

export interface R2Object {
  key: string;
  version: string;
  size: number;
  etag: string;
  uploaded: Date;
  httpMetadata?: Record<string, string>;
  customMetadata?: Record<string, string>;
}

export interface R2ObjectBody extends R2Object {
  body: ReadableStream;
  bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T>(): Promise<T>;
}

export interface R2Objects {
  objects: R2Object[];
  delimitedPrefixes: string[];
  truncated: boolean;
  cursor?: string;
}

export interface R2ListOptions {
  limit?: number;
  prefix?: string;
  cursor?: string;
  delimiter?: string;
  startAfter?: string;
}

/** Cloudflare Queue — typed interface for message production */
export interface Queue<Body = unknown> {
  send(body: Body, options?: { contentType?: 'text' | 'json' | 'bytes'; delaySeconds?: number }): Promise<void>;
  sendBatch(batch: Array<{ body: Body; contentType?: 'text' | 'json' | 'bytes'; delaySeconds?: number }>): Promise<void>;
}

/** Cloudflare Durable Object stub */
export interface DurableObjectNamespace {
  newUniqueId(): DurableObjectId;
  idFromName(name: string): DurableObjectId;
  idFromString(id: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

export interface DurableObjectId {
  name?: string;
  equals(other: DurableObjectId): boolean;
  toString(): string;
}

export interface DurableObjectStub {
  fetch(url: Request | string, init?: RequestInit): Promise<Response>;
}

/** Cloudflare Durable Object state — passed to DO constructor */
export interface DurableObjectState {
  id: DurableObjectId;
  storage: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<boolean>;
    list<T = unknown>(options?: { prefix?: string; limit?: number }): Promise<Map<string, T>>;
  };
  waitUntil(promise: Promise<unknown>): void;
  blockConcurrencyWhile(callback: () => Promise<unknown>): Promise<void>;
  tags?: string[];
}

/** Combined Cloudflare bindings passed to handlers */
export interface CloudflareBindings {
  [key: string]: unknown;
  DB?: D1Database | any;
  RESUME_KV?: KVNamespace | any;
  EXPORT_R2?: R2Bucket | any;
  OPTIMIZATION_QUEUE?: Queue | any;
  SESSION_DO?: DurableObjectNamespace | any;
  ENVIRONMENT?: string;
}
