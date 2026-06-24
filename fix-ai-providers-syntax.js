const fs = require('fs');
const file = 'src/components/app/modules/AIProviders.tsx';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/try \{\n\s*\}\n\s*\}, \[\]\);/m, '}, []);');
code = code.replace(/try \{\n\s*\}, \[\]\);/m, '}, []);');

fs.writeFileSync(file, code);
