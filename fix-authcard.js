const fs = require('fs');
const file = 'src/components/app/modules/PuterAuthCard.tsx';
let code = fs.readFileSync(file, 'utf8');

if (!code.includes('import { Label }')) {
  code = code.replace(/import \{ Switch \} from "@\/components\/ui\/switch";/, `import { Switch } from "@/components/ui/switch";\nimport { Label } from "@/components/ui/label";`);
}
// Clean up escaped string literals
code = code.replace(/\\\$/g, "$");

fs.writeFileSync(file, code);
