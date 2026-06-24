const fs = require('fs');
const file = 'src/components/app/modules/AIProviders.tsx';
let code = fs.readFileSync(file, 'utf8');

// Also remove `getZaiProvider` from useEffect since we deleted it
code = code.replace(/try \{ const s = await getZaiProvider\(\)\.restore\(\); zaiOk = !!s\?\.authenticated; \} catch \(e\) \{ console\.warn\("\[AIProviders\] Z\.ai restore failed:", e instanceof Error \? e\.message : e\); \}/g, '');
code = code.replace(/if \(puterOk \|\| zaiOk\)/g, 'if (puterOk)');
code = code.replace(/let zaiOk = false;/g, '');
code = code.replace(/import \{ GoogleUserInfo \} from "@\/lib\/providers\/zai-provider";/g, '');

fs.writeFileSync(file, code);
