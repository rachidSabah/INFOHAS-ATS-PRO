const fs = require('fs');
const file = 'src/components/app/modules/AIProviders.tsx';
let code = fs.readFileSync(file, 'utf8');

if (!code.includes('import { PuterAuthCard } from "./PuterAuthCard";')) {
  code = code.replace(/import \{ ProviderAuthCard \} from "\.\/ProviderAuthCard";/, `import { ProviderAuthCard } from "./ProviderAuthCard";\nimport { PuterAuthCard } from "./PuterAuthCard";`);
}

code = code.replace(/\{\/\* Puter\.js Auth \*\/\}[\s\S]*?onToggleShared=\{[\s\S]*?\}\n\s*\/>/, `{/* Puter.js Auth (Multi-Account) */}
            <PuterAuthCard status={puterStatus} onRefreshStatus={refreshAuthStatus} />`);

fs.writeFileSync(file, code);
