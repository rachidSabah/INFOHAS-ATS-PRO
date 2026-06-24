const fs = require('fs');
const file = 'src/components/app/modules/AIProviders.tsx';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/<li>• <strong>Z\.ai Direct<\/strong> supports both Google OAuth and API key authentication\. Google sign-in links your Google account to your Z\.ai API key for future auto-login\.<\/li>\n/g, "");

fs.writeFileSync(file, code);
