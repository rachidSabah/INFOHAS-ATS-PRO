const fs = require('fs');
const file = 'src/components/app/modules/AIProviders.tsx';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/import \{ getPuterProvider, getZaiProvider, isGoogleOAuthConfigured \} from "@\/lib\/providers";/, 'import { getPuterProvider, isGoogleOAuthConfigured } from "@/lib/providers";');
code = code.replace(/const \[zaiStatus, setZaiStatus\] = useState<ProviderAuthStatus>\(\{[\s\S]*?\}\);/, '');
code = code.replace(/const \[zaiApiKeyInput, setZaiApiKeyInput\] = useState\(""\);/, '');
code = code.replace(/const \[pendingGoogleUser, setPendingGoogleUser\] = useState<any \| null>\(null\);/, '');

// Delete refreshAuthStatus logic
code = code.replace(/setZaiStatus\(getZaiProvider\(\)\.getStatus\(\)\);\n\s*\} catch \(e\) \{ console\.warn\("\[AIProviders\] Z\.ai status check failed:", e instanceof Error \? e\.message : e\); \}/, '');

// Delete zaiOk logic
code = code.replace(/let zaiOk = false;\n\s*try \{ const s = await getZaiProvider\(\)\.restore\(\); zaiOk = !!s\?\.authenticated; \} catch \(e\) \{ console\.warn\("\[AIProviders\] Z\.ai restore failed:", e instanceof Error \? e\.message : e\); \}/, '');
code = code.replace(/const totalOk = puterOk \|\| zaiOk;/, 'const totalOk = puterOk;');

// Delete the Zai rendering
code = code.replace(/\{\/\* Z\.ai Direct Auth \*\/\}[\s\S]*?\{\/\* Puter\.js Auth \(Multi-Account\) \*\/\}/, '{/* Puter.js Auth (Multi-Account) */}');
code = code.replace(/\{ label: "OAuth Auth", value: \[puterStatus\.authenticated, zaiStatus\.authenticated\]\.filter\(Boolean\)\.length, icon: "Shield", color: "#10B981" \},/, '{ label: "OAuth Auth", value: [puterStatus.authenticated].filter(Boolean).length, icon: "Shield", color: "#10B981" },');

fs.writeFileSync(file, code);
