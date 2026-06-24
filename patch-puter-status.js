const fs = require('fs');
const file = 'src/lib/providers/puter-provider.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/getStatus\(\): ProviderAuthStatus \{[\s\S]*?return \{[\s\S]*?googlePicture: this\.session\.googlePicture,[\s\S]*?\};[\s\S]*?\}/, `getStatus(): ProviderAuthStatus {
    return {
      connected: this.session.authenticated,
      authenticated: this.session.authenticated,
      email: this.session.email,
      expiresAt: this.session.expiresAt,
      models: this.session.models,
      sharedAdminAccount: this.session.sharedAdminAccount,
      authMethod: this.session.authMethod,
      googleUserId: this.session.googleUserId,
      googlePicture: this.session.googlePicture,
      accounts: this.accounts,
      autoRotate: this.autoRotate,
      useGlobally: this.useGlobally,
    };
  }`);

fs.writeFileSync(file, code);
