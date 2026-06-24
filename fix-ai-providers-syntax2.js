const fs = require('fs');
const file = 'src/components/app/modules/AIProviders.tsx';
let code = fs.readFileSync(file, 'utf8');

// Replace the broken block
code = code.replace(/const refreshAuthStatus = useCallback\(\(\) => \{[\s\S]*?\}, \[\]\);/m, `const refreshAuthStatus = useCallback(() => {
    try {
      setPuterStatus(getPuterProvider().getStatus());
    } catch (e) { console.warn("[AIProviders] Puter status check failed:", e instanceof Error ? e.message : e); }
  }, []);`);

fs.writeFileSync(file, code);
