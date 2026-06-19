// Build-time script: generates /public/repo-index.json with all source files
// This allows the AI Workspace agent to read REAL files on Cloudflare Pages
// (Edge runtime can't use fs, so we pre-bundle everything at build time)

const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const ALLOWED_DIRS = ["src", "migrations", "workers"];
const ROOT_FILES = ["package.json", "tsconfig.json", "next.config.ts", "wrangler.toml", "tailwind.config.ts", "eslint.config.mjs"];
const MAX_FILE_SIZE = 100 * 1024; // 100KB per file
const EXCLUDED_DIRS = ["node_modules", ".next", ".git", ".wrangler", "dist", "build", "coverage", "download", "upload", "tool-results", "skills", "scripts", "examples"];

function walkDir(dir, files = []) {
  try {
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      if (EXCLUDED_DIRS.includes(entry)) continue;
      const fullPath = path.join(dir, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          walkDir(fullPath, files);
        } else if (stat.isFile() && stat.size < MAX_FILE_SIZE) {
          const ext = path.extname(entry);
          if ([".ts", ".tsx", ".js", ".jsx", ".json", ".sql", ".css", ".md", ".yml", ".yaml", ".toml", ".mjs"].includes(ext)) {
            const relativePath = path.relative(PROJECT_ROOT, fullPath).replace(/\\/g, "/");
            files.push(relativePath);
          }
        }
      } catch {}
    }
  } catch {}
  return files;
}

function main() {
  console.log("[repo-index] Generating repository index...");
  const allFiles = [];

  // Walk allowed directories
  for (const dir of ALLOWED_DIRS) {
    const fullPath = path.join(PROJECT_ROOT, dir);
    if (fs.existsSync(fullPath)) {
      walkDir(fullPath, allFiles);
    }
  }

  // Add root config files
  for (const file of ROOT_FILES) {
    if (fs.existsSync(path.join(PROJECT_ROOT, file))) {
      allFiles.push(file);
    }
  }

  // Also add .github/workflows
  const githubDir = path.join(PROJECT_ROOT, ".github", "workflows");
  if (fs.existsSync(githubDir)) {
    walkDir(githubDir, allFiles);
  }

  // Read file contents
  const index = {};
  let totalSize = 0;
  for (const filePath of allFiles) {
    try {
      const fullPath = path.join(PROJECT_ROOT, filePath);
      const content = fs.readFileSync(fullPath, "utf-8");
      index[filePath] = content;
      totalSize += content.length;
    } catch (e) {
      // Skip unreadable files
    }
  }

  // Write to public/repo-index.json
  const outputPath = path.join(PROJECT_ROOT, "public", "repo-index.json");
  fs.writeFileSync(outputPath, JSON.stringify(index));

  console.log(`[repo-index] Generated ${outputPath}`);
  console.log(`[repo-index] ${Object.keys(index).length} files, ${(totalSize / 1024).toFixed(1)}KB total`);
}

main();
