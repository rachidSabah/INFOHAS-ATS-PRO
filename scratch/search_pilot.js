const fs = require('fs');
const path = require('path');

function searchInDir(dir, query) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      searchInDir(fullPath, query);
    } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (content.toLowerCase().includes(query.toLowerCase())) {
        console.log(`Found "${query}" in: ${fullPath}`);
      }
    }
  }
}

console.log("Searching for 'pilot' in src/components/app/modules...");
searchInDir('src/components/app/modules', 'pilot');
console.log("\nSearching for 'pilot' in src/lib...");
searchInDir('src/lib', 'pilot');
