const fs = require('fs');
const file = 'src/lib/ai.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/const zaiProvider = getZaiProvider\(\);/, '');

fs.writeFileSync(file, code);
