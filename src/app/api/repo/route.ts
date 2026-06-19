// Repository Intelligence API — reads REAL files from the project
// Allows the AI Workspace agent to inspect actual source code.
//
// Actions:
//   read    — return file contents
//   search  — search all source files for a string/regex
//   list    — list files in a directory

import { NextRequest, NextResponse } from "next/server";
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, resolve, sep } from "path";

export const runtime = "nodejs"; // Need fs access — not Edge compatible

const PROJECT_ROOT = resolve(process.cwd());
const ALLOWED_DIRS = ["src", "migrations", "workers", "public"];
const MAX_FILE_SIZE = 500 * 1024; // 500KB max per file read
const MAX_SEARCH_RESULTS = 100;

// Security: ensure the path is within the project and an allowed directory
function safePath(path: string): string | null {
  // Normalize the path
  const fullPath = resolve(PROJECT_ROOT, path);

  // Must be within the project root
  if (!fullPath.startsWith(PROJECT_ROOT + sep) && fullPath !== PROJECT_ROOT) {
    return null;
  }

  // Must be within an allowed directory (or root config files)
  const relativePath = fullPath.slice(PROJECT_ROOT.length + 1);
  const topDir = relativePath.split(sep)[0];

  // Allow root config files (package.json, tsconfig.json, etc.)
  const rootConfigs = ["package.json", "tsconfig.json", "next.config.ts", "wrangler.toml", "tailwind.config.ts", "eslint.config.mjs", ".github"];
  if (rootConfigs.some((cfg) => relativePath === cfg || relativePath.startsWith(cfg + sep))) {
    return fullPath;
  }

  if (!ALLOWED_DIRS.includes(topDir)) {
    return null;
  }

  return fullPath;
}

function shouldSearchFile(filePath: string): boolean {
  const exts = [".ts", ".tsx", ".js", ".jsx", ".json", ".sql", ".css", ".md", ".yml", ".yaml", ".toml"];
  return exts.some((ext) => filePath.endsWith(ext));
}

function walkDir(dir: string, results: string[] = [], maxDepth = 10, depth = 0): string[] {
  if (depth > maxDepth) return results;
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          // Skip node_modules, .next, .git, etc.
          if (["node_modules", ".next", ".git", ".wrangler", "dist", "build", "coverage"].includes(entry)) continue;
          walkDir(fullPath, results, maxDepth, depth + 1);
        } else if (stat.isFile() && shouldSearchFile(fullPath)) {
          results.push(fullPath);
        }
      } catch {
        // Skip files we can't stat
      }
    }
  } catch {
    // Skip directories we can't read
  }
  return results;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    if (action === "read") {
      const { path } = body;
      if (!path || typeof path !== "string") {
        return NextResponse.json({ error: "path is required" }, { status: 400 });
      }

      const fullPath = safePath(path);
      if (!fullPath) {
        return NextResponse.json({ error: "Access denied: path outside allowed directories" }, { status: 403 });
      }

      if (!existsSync(fullPath)) {
        return NextResponse.json({ error: `File not found: ${path}` }, { status: 404 });
      }

      const stat = statSync(fullPath);
      if (stat.size > MAX_FILE_SIZE) {
        return NextResponse.json({ error: `File too large: ${stat.size} bytes (max ${MAX_FILE_SIZE})` }, { status: 413 });
      }

      const content = readFileSync(fullPath, "utf-8");
      return NextResponse.json({ path, content, size: stat.size });
    }

    if (action === "search") {
      const { query, regex, filePattern } = body;
      if (!query || typeof query !== "string") {
        return NextResponse.json({ error: "query is required" }, { status: 400 });
      }

      // Determine which directories to search
      const searchDirs = ALLOWED_DIRS.map((d) => join(PROJECT_ROOT, d));
      const allFiles: string[] = [];
      for (const dir of searchDirs) {
        if (existsSync(dir)) {
          walkDir(dir, allFiles);
        }
      }
      // Also search root config files
      for (const cfg of ["package.json", "tsconfig.json", "next.config.ts", "wrangler.toml"]) {
        const cfgPath = join(PROJECT_ROOT, cfg);
        if (existsSync(cfgPath)) allFiles.push(cfgPath);
      }

      // Filter by file pattern if provided
      let filesToSearch = allFiles;
      if (filePattern) {
        // Simple glob: *.ts, *.tsx, **/route.ts, *.{ts,tsx}
        const pattern = filePattern
          .replace(/\*\*/g, ".*")
          .replace(/\*/g, "[^/]*")
          .replace(/\{([^}]+)\}/, (_, exts) => `(${exts.replace(/,/g, "|")})`);
        const re = new RegExp(pattern + "$");
        filesToSearch = allFiles.filter((f) => re.test(f));
      }

      const results: Array<{ file: string; line: number; match: string; context: string[]; function?: string }> = [];
      let searchRe: RegExp;
      try {
        searchRe = regex ? new RegExp(query, "i") : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      } catch {
        return NextResponse.json({ error: "Invalid search query" }, { status: 400 });
      }

      for (const filePath of filesToSearch) {
        if (results.length >= MAX_SEARCH_RESULTS) break;
        try {
          const content = readFileSync(filePath, "utf-8");
          const lines = content.split("\n");

          for (let i = 0; i < lines.length; i++) {
            if (results.length >= MAX_SEARCH_RESULTS) break;
            if (searchRe.test(lines[i])) {
              const relativePath = filePath.slice(PROJECT_ROOT.length + 1).replace(/\\/g, "/");
              const context: string[] = [];
              for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 2); j++) {
                context.push(`${j + 1}: ${lines[j]}`);
              }

              // Try to find the enclosing function
              let funcName: string | undefined;
              for (let j = i; j >= 0; j--) {
                const funcMatch = lines[j].match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
                if (funcMatch) { funcName = funcMatch[1]; break; }
                const constMatch = lines[j].match(/(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(?/);
                if (constMatch && !["if", "for", "while"].includes(constMatch[1])) { funcName = constMatch[1]; break; }
              }

              results.push({
                file: relativePath,
                line: i + 1,
                match: lines[i].trim(),
                context,
                function: funcName,
              });
            }
          }
        } catch {
          // Skip files we can't read
        }
      }

      return NextResponse.json({ results, total: results.length, truncated: results.length >= MAX_SEARCH_RESULTS });
    }

    if (action === "list") {
      const { path = "src" } = body;
      const fullPath = safePath(path);
      if (!fullPath) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }

      try {
        const entries = readdirSync(fullPath).map((entry) => {
          const entryPath = join(fullPath, entry);
          try {
            const stat = statSync(entryPath);
            return {
              name: entry,
              path: join(path, entry).replace(/\\/g, "/"),
              type: stat.isDirectory() ? "directory" : "file",
              size: stat.isFile() ? stat.size : undefined,
            };
          } catch {
            return null;
          }
        }).filter(Boolean);

        return NextResponse.json({ path, entries });
      } catch {
        return NextResponse.json({ error: `Cannot list directory: ${path}` }, { status: 404 });
      }
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}
