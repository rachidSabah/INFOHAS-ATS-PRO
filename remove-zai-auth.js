const fs = require('fs');
const file = 'src/components/app/modules/AIProviders.tsx';
let code = fs.readFileSync(file, 'utf8');

const regex = /\{\/\* Z\.ai Direct Auth \*\/\}[\s\S]*?\{\/\* Puter\.js Auth \(Multi-Account\) \*\/\}/;

code = code.replace(regex, '{/* Puter.js Auth (Multi-Account) */}');
fs.writeFileSync(file, code);
