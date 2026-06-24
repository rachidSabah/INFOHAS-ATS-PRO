const fs = require('fs');
const file = 'src/lib/ai.ts';
let code = fs.readFileSync(file, 'utf8');

const regex = /\/\/ NEW: Also try the Z\.ai Direct OAuth provider[\s\S]*?console\.warn\("\[AI\] Z\.ai Direct OAuth provider failed, trying Puter:", e\?\.message\);\n    \}/;

code = code.replace(regex, '');
fs.writeFileSync(file, code);
