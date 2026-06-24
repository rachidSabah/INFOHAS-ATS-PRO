const fs = require('fs');
const file = 'src/components/app/modules/AIProviders.tsx';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/const \[tab, setTab\] = useState<Tab>\(!puterStatus\.authenticated && !zaiStatus\.authenticated \? "auth" : "providers"\);/g, 'const [tab, setTab] = useState<Tab>(!puterStatus.authenticated ? "auth" : "providers");');

fs.writeFileSync(file, code);
