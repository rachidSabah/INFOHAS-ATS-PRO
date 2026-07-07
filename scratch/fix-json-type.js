const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else {
      if (file.endsWith('.ts') || file.endsWith('.tsx')) {
        results.push(file);
      }
    }
  });
  return results;
}

const srcDir = path.join(__dirname, '..', 'src');
const files = walk(srcDir);

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;

  // Step 1: replace anyVar.json().catch(...)
  // We match: await identifier.json().catch(...)
  // The identifier can be any word character
  const catchRegex = /await\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\.json\(\)\.catch\(\s*\(\)\s*=>\s*(?:\{\}|\(\{\}\))\)/g;
  if (catchRegex.test(content)) {
    content = content.replace(catchRegex, '(await $1.json().catch(() => ({}))) as any');
    changed = true;
  }

  // Step 2: replace plain await anyVar.json()
  // We use negative lookbehind/lookahead to prevent double-wrapping
  const plainRegex = /(?<!\()await\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\.json\(\)(?!\s*as\s+any)/g;
  if (plainRegex.test(content)) {
    content = content.replace(plainRegex, '(await $1.json()) as any');
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(file, content, 'utf8');
    console.log(`Updated: ${file}`);
  }
});
