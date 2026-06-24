const fs = require('fs');
const file = 'src/lib/providers/puter-provider.ts';
let code = fs.readFileSync(file, 'utf8');

const str = `
  async setAutoRotate(enabled: boolean): Promise<void> {
    this.autoRotate = enabled;
    await this.saveAccounts();
  }

  async setUseGlobally(enabled: boolean): Promise<void> {
    this.useGlobally = enabled;
    await this.saveAccounts();
  }

  // Private helpers
`;

code = code.replace(/\/\/ Private helpers/, str);
fs.writeFileSync(file, code);
