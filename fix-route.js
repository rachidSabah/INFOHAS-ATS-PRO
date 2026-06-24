const fs = require('fs');

const files = [
  'src/app/api/providers/puter/accounts/route.ts',
  'src/app/api/providers/puter/login/route.ts',
  'src/app/api/providers/puter/rotate/route.ts',
  'src/app/api/providers/puter/switch/route.ts'
];

files.forEach(file => {
  let code = fs.readFileSync(file, 'utf8');
  code = code.replace(/\\\$/g, "$");
  fs.writeFileSync(file, code);
});
