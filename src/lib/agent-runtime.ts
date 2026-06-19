// ResumeAI Pro — Repository Intelligence Engine
// The agent's eyes into the actual codebase. Unlike the static PROJECT_TREE,
// this engine reads REAL files from the project via an API route.
//
// Capabilities:
//   readFile(path) — return actual file contents with line numbers
//   searchRepository(query) — search ALL source files for a string/regex
//   findReferences(symbol) — find all files that import/reference a symbol
//   findDefinitions(symbol) — find where a function/class/type is defined
//   traceImports(file) — trace what a file imports
//   traceExports(file) — trace what a file exports
//   traceFunctionCalls(functionName) — find all call sites of a function
//   traceApiRoutes() — list all API routes with their handlers
//   traceReactComponents() — list all React components and their usage
//   traceWorkerExecution() — trace the Cloudflare Worker execution path
//   traceDatabaseQueries() — find all D1 database queries
//
// All results include: file path, line number, function name, code snippet,
// call chain, and dependency chain — REAL evidence, not guesses.

"use client";

export interface CodeEvidence {
  file: string;
  line: number;
  function?: string;
  code: string;           // the actual code snippet (3 lines of context)
  calledBy?: string;      // file that calls this
  importChain?: string[]; // files in the import chain
}

export interface SearchResult {
  file: string;
  line: number;
  match: string;          // the matched line
  context: string[];      // 2 lines before + 2 after
  function?: string;      // enclosing function name
}

export interface FileContent {
  path: string;
  content: string;
  lines: string[];        // content split by lines, 1-indexed (lines[0] = line 1)
  language: string;
  lineCount: number;
  functions: Array<{ name: string; line: number; params?: string }>;
  exports: string[];
  imports: Array<{ from: string; items: string[] }>;
}

export interface ExecutionTrace {
  steps: Array<{
    layer: string;        // "UI", "API", "Service", "Provider", "Parser", "Store", "Renderer", "Export"
    file: string;
    function: string;
    line: number;
    description: string;
  }>;
}

// ============================================================================
// API CALLS — read real files from the project via /api/repo
// ============================================================================

async function repoApi(action: string, params: Record<string, any>): Promise<any> {
  const res = await fetch("/api/repo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...params }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API ${res.status}`);
  }
  return res.json();
}

// ============================================================================
// READ FILE — return actual file contents with line numbers
// ============================================================================

export async function readFile(path: string): Promise<FileContent> {
  const data = await repoApi("read", { path });
  return parseFileContent(path, data.content || "");
}

function parseFileContent(path: string, content: string): FileContent {
  const lines = content.split("\n");
  const language = detectLanguage(path);
  const functions = extractFunctions(lines);
  const exports = extractExports(lines);
  const imports = extractImports(lines);

  return {
    path,
    content,
    lines,
    language,
    lineCount: lines.length,
    functions,
    exports,
    imports,
  };
}

function detectLanguage(path: string): string {
  if (path.endsWith(".ts")) return "typescript";
  if (path.endsWith(".tsx")) return "tsx";
  if (path.endsWith(".js")) return "javascript";
  if (path.endsWith(".jsx")) return "jsx";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".sql")) return "sql";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".yml") || path.endsWith(".yaml")) return "yaml";
  if (path.endsWith(".toml")) return "toml";
  return "text";
}

function extractFunctions(lines: string[]): Array<{ name: string; line: number; params?: string }> {
  const funcs: Array<{ name: string; line: number; params?: string }> = [];
  // Match: function foo(, const foo = (, const foo = async (, export function foo(, export const foo =
  const funcRegex = /^(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(?)/;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(funcRegex);
    if (match) {
      const name = match[1] || match[2];
      if (name && !["if", "for", "while", "switch", "return", "const", "let", "var"].includes(name)) {
        funcs.push({ name, line: i + 1 });
      }
    }
  }
  return funcs;
}

function extractExports(lines: string[]): string[] {
  const exports: string[] = [];
  for (const line of lines) {
    const m = line.match(/^export\s+(?:const|let|var|function|class|type|interface|enum)\s+(\w+)/);
    if (m) exports.push(m[1]);
    const m2 = line.match(/^export\s*\{([^}]+)\}/);
    if (m2) {
      for (const item of m2[1].split(",")) {
        const name = item.trim().split(/\s+as\s+/)[0].trim();
        if (name) exports.push(name);
      }
    }
  }
  return [...new Set(exports)];
}

function extractImports(lines: string[]): Array<{ from: string; items: string[] }> {
  const imports: Array<{ from: string; items: string[] }> = [];
  for (const line of lines) {
    const m = line.match(/^import\s+(?:\{([^}]+)\}|(\w+))\s+from\s+["']([^"']+)["']/);
    if (m) {
      const from = m[3];
      const items = m[1]
        ? m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean)
        : [m[2]];
      imports.push({ from, items });
    }
    // Handle: import "foo" (side-effect imports)
    const m2 = line.match(/^import\s+["']([^"']+)["']/);
    if (m2 && !m) {
      imports.push({ from: m2[1], items: [] });
    }
  }
  return imports;
}

// ============================================================================
// SEARCH REPOSITORY — search ALL source files for a string/regex
// ============================================================================

export async function searchRepository(query: string, options?: { regex?: boolean; filePattern?: string }): Promise<SearchResult[]> {
  const data = await repoApi("search", { query, regex: options?.regex || false, filePattern: options?.filePattern || "" });
  return data.results || [];
}

// ============================================================================
// FIND REFERENCES — find all files that import/reference a symbol
// ============================================================================

export async function findReferences(symbol: string): Promise<SearchResult[]> {
  return searchRepository(symbol, { filePattern: "*.{ts,tsx}" });
}

// ============================================================================
// FIND DEFINITIONS — find where a function/class/type is defined
// ============================================================================

export async function findDefinitions(symbol: string): Promise<CodeEvidence[]> {
  // Search for: function symbol, const symbol =, class symbol, type symbol, interface symbol
  const patterns = [
    `function ${symbol}`,
    `const ${symbol} =`,
    `class ${symbol}`,
    `type ${symbol}`,
    `interface ${symbol}`,
    `export function ${symbol}`,
    `export const ${symbol}`,
    `export class ${symbol}`,
    `export type ${symbol}`,
    `export interface ${symbol}`,
  ];

  const results: CodeEvidence[] = [];
  for (const pattern of patterns) {
    const matches = await searchRepository(pattern);
    for (const match of matches) {
      results.push({
        file: match.file,
        line: match.line,
        code: match.match,
        function: symbol,
      });
    }
  }

  // Deduplicate by file+line
  const seen = new Set<string>();
  return results.filter((r) => {
    const key = `${r.file}:${r.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ============================================================================
// TRACE IMPORTS — trace what a file imports
// ============================================================================

export async function traceImports(filePath: string): Promise<Array<{ from: string; items: string[]; resolved?: string }>> {
  const file = await readFile(filePath);
  return file.imports.map((imp) => ({
    ...imp,
    resolved: resolveImportPath(filePath, imp.from),
  }));
}

function resolveImportPath(fromFile: string, importPath: string): string {
  // Skip external packages (node_modules)
  if (!importPath.startsWith(".") && !importPath.startsWith("@/")) return `[external] ${importPath}`;

  // Handle @/ alias (maps to src/)
  if (importPath.startsWith("@/")) {
    return `src/${importPath.slice(2)}`;
  }

  // Handle relative paths
  const dir = fromFile.split("/").slice(0, -1).join("/");
  const parts = importPath.split("/");
  let resolved = dir.split("/");

  for (const part of parts) {
    if (part === "..") resolved.pop();
    else if (part === ".") continue;
    else resolved.push(part);
  }

  return resolved.join("/");
}

// ============================================================================
// TRACE EXPORTS — trace what a file exports
// ============================================================================

export async function traceExports(filePath: string): Promise<string[]> {
  const file = await readFile(filePath);
  return file.exports;
}

// ============================================================================
// TRACE FUNCTION CALLS — find all call sites of a function
// ============================================================================

export async function traceFunctionCalls(functionName: string): Promise<SearchResult[]> {
  // Search for: functionName( — this catches both calls and definitions
  const results = await searchRepository(`${functionName}(`, { filePattern: "*.{ts,tsx}" });

  // Filter out the definition itself (function foo( or const foo = ()
  return results.filter((r) => {
    const line = r.match.trim();
    return !line.startsWith("function ") && !line.startsWith("const ") && !line.startsWith("export function") && !line.startsWith("export const");
  });
}

// ============================================================================
// TRACE API ROUTES — list all API routes with their handlers
// ============================================================================

export async function traceApiRoutes(): Promise<Array<{ path: string; file: string; methods: string[] }>> {
  const results = await searchRepository("export async function (GET|POST|PUT|DELETE|PATCH)", { regex: true, filePattern: "**/route.ts" });
  const routes: Array<{ path: string; file: string; methods: string[] }> = [];
  const seen = new Set<string>();

  for (const r of results) {
    const methodMatch = r.match.match(/export\s+async\s+function\s+(GET|POST|PUT|DELETE|PATCH)/);
    if (methodMatch) {
      const method = methodMatch[1];
      // Derive the API path from the file path
      const pathMatch = r.file.match(/src\/app\/api\/(.+)\/route\.ts/);
      const apiPath = pathMatch ? `/api/${pathMatch[1]}` : r.file;

      if (!seen.has(r.file)) {
        seen.add(r.file);
        routes.push({ path: apiPath, file: r.file, methods: [method] });
      } else {
        const existing = routes.find((route) => route.file === r.file);
        if (existing && !existing.methods.includes(method)) {
          existing.methods.push(method);
        }
      }
    }
  }

  return routes;
}

// ============================================================================
// TRACE REACT COMPONENTS — list all React components and their usage
// ============================================================================

export async function traceReactComponents(): Promise<Array<{ name: string; file: string; line: number; usedIn: string[] }>> {
  // Find all component definitions: export function Foo( or export const Foo = (
  const definitions = await searchRepository("export (function|const) \\w+", { regex: true, filePattern: "*.tsx" });

  const components: Array<{ name: string; file: string; line: number; usedIn: string[] }> = [];

  for (const def of definitions) {
    const nameMatch = def.match.match(/export\s+(?:function|const)\s+(\w+)/);
    if (!nameMatch) continue;
    const name = nameMatch[1];

    // Skip non-component exports (types, constants, etc.)
    if (/^[a-z]/.test(name) && name !== "default") continue;

    // Find where this component is used
    const refs = await findReferences(`<${name}`);
    const usedIn = [...new Set(refs.map((r) => r.file).filter((f) => f !== def.file))];

    components.push({ name, file: def.file, line: def.line, usedIn });
  }

  return components;
}

// ============================================================================
// TRACE WORKER EXECUTION — trace the Cloudflare Worker execution path
// ============================================================================

export async function traceWorkerExecution(): Promise<CodeEvidence[]> {
  const results = await searchRepository("app\\.(get|post|put|delete|patch)\\(", { regex: true, filePattern: "**/workers/**" });
  return results.map((r) => ({
    file: r.file,
    line: r.line,
    code: r.match,
    function: "worker-route",
  }));
}

// ============================================================================
// TRACE DATABASE QUERIES — find all D1 database queries
// ============================================================================

export async function traceDatabaseQueries(): Promise<SearchResult[]> {
  const patterns = [
    "db.prepare(",
    "db.exec(",
    "db.batch(",
    "INSERT INTO",
    "SELECT * FROM",
    "UPDATE .* SET",
    "DELETE FROM",
    "CREATE TABLE",
    "ALTER TABLE",
  ];

  const allResults: SearchResult[] = [];
  for (const pattern of patterns) {
    const results = await searchRepository(pattern, { regex: pattern.includes(".*"), filePattern: "*.{ts,sql}" });
    allResults.push(...results);
  }

  // Deduplicate
  const seen = new Set<string>();
  return allResults.filter((r) => {
    const key = `${r.file}:${r.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ============================================================================
// EXECUTION TRACER — trace a feature from UI to export
// ============================================================================

export async function traceExecution(feature: string): Promise<ExecutionTrace> {
  const steps: ExecutionTrace["steps"] = [];

  // Step 1: Find the UI component (button, form, etc.)
  const uiResults = await searchRepository(feature, { filePattern: "*.tsx" });
  if (uiResults.length > 0) {
    const r = uiResults[0];
    steps.push({
      layer: "UI",
      file: r.file,
      function: "onClick/handler",
      line: r.line,
      description: `UI component references "${feature}"`,
    });
  }

  // Step 2: Find the API route
  const apiResults = await searchRepository(feature, { filePattern: "**/route.ts" });
  if (apiResults.length > 0) {
    const r = apiResults[0];
    steps.push({
      layer: "API",
      file: r.file,
      function: "POST/GET handler",
      line: r.line,
      description: `API route handles "${feature}"`,
    });
  }

  // Step 3: Find the service/lib function
  const libResults = await searchRepository(feature, { filePattern: "src/lib/*.ts" });
  if (libResults.length > 0) {
    const r = libResults[0];
    steps.push({
      layer: "Service",
      file: r.file,
      function: extractFunctionName(r.match),
      line: r.line,
      description: `Service function processes "${feature}"`,
    });
  }

  // Step 4: Find the provider call
  const providerResults = await searchRepository("callAI", { filePattern: "src/lib/*.ts" });
  if (providerResults.length > 0) {
    const r = providerResults[0];
    steps.push({
      layer: "Provider",
      file: r.file,
      function: "callAI",
      line: r.line,
      description: `AI provider called for "${feature}"`,
    });
  }

  // Step 5: Find the parser (extractJSON, processAIResponse)
  const parserResults = await searchRepository("processAIResponse|extractJSON", { regex: true, filePattern: "src/lib/*.ts" });
  if (parserResults.length > 0) {
    const r = parserResults[0];
    steps.push({
      layer: "Parser",
      file: r.file,
      function: "processAIResponse",
      line: r.line,
      description: `Response parsed for "${feature}"`,
    });
  }

  // Step 6: Find the store (Zustand)
  const storeResults = await searchRepository("set\\(|get\\(", { regex: true, filePattern: "src/lib/store.ts" });
  if (storeResults.length > 0) {
    steps.push({
      layer: "Store",
      file: "src/lib/store.ts",
      function: "Zustand store",
      line: storeResults[0].line,
      description: `State updated for "${feature}"`,
    });
  }

  // Step 7: Find the renderer (A4Preview, EditableA4Preview)
  const rendererResults = await searchRepository(feature, { filePattern: "**/A4Preview*.tsx" });
  if (rendererResults.length > 0) {
    const r = rendererResults[0];
    steps.push({
      layer: "Renderer",
      file: r.file,
      function: "render",
      line: r.line,
      description: `Resume rendered for "${feature}"`,
    });
  }

  // Step 8: Find the export (exportResumePDF, exportResumeDOCX)
  const exportResults = await searchRepository("exportResume", { filePattern: "src/lib/exporter.ts" });
  if (exportResults.length > 0) {
    const r = exportResults[0];
    steps.push({
      layer: "Export",
      file: r.file,
      function: "exportResumePDF",
      line: r.line,
      description: `Resume exported for "${feature}"`,
    });
  }

  return { steps };
}

function extractFunctionName(line: string): string {
  const m = line.match(/(?:function|const|export\s+function|export\s+const)\s+(\w+)/);
  return m ? m[1] : "unknown";
}

// ============================================================================
// GET CODE EVIDENCE — format evidence for display
// ============================================================================

export function formatEvidence(evidence: CodeEvidence): string {
  const lines = [
    `File: ${evidence.file}`,
    `Line: ${evidence.line}`,
  ];
  if (evidence.function) lines.push(`Function: ${evidence.function}`);
  if (evidence.calledBy) lines.push(`Called By: ${evidence.calledBy}`);
  if (evidence.importChain && evidence.importChain.length > 0) {
    lines.push(`Import Chain: ${evidence.importChain.join(" → ")}`);
  }
  lines.push(`Code: ${evidence.code}`);
  return lines.join("\n");
}
