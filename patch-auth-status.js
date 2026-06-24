const fs = require('fs');
const file = 'src/lib/providers/interface.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/googlePicture: string \| null;/, `googlePicture: string | null;
  accounts?: any[]; // For multi-account providers like Puter
  autoRotate?: boolean;
  useGlobally?: boolean;`);

fs.writeFileSync(file, code);
