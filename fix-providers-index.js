const fs = require('fs');
const file = 'src/lib/providers/index.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/export \{ getZaiProvider, ZaiProvider \} from "\.\/zai-provider";/g, '');
code = code.replace(/import \{ getZaiProvider \} from "\.\/zai-provider";/g, '');
code = code.replace(/const zaiProvider = getZaiProvider\(\);\n\s*try \{\n\s*await zaiProvider\.logout\(\);\n\s*\} catch \(e\) \{\}/g, '');
code = code.replace(/const zaiProvider = getZaiProvider\(\);\n\s*const zaiOk = await zaiProvider\.tryRefresh\(\);/g, 'const zaiOk = false;');
code = code.replace(/const zaiProvider = getZaiProvider\(\);\n\s*if \(zaiProvider\.isAuthenticated\(\)\) return zaiProvider;/g, '');
code = code.replace(/const zaiProvider = getZaiProvider\(\);\n\s*if \(await zaiProvider\.tryRefresh\(\)\) \{\n\s*return zaiProvider;\n\s*\}/g, '');

fs.writeFileSync(file, code);
