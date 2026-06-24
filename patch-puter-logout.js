const fs = require('fs');
const file = 'src/lib/providers/puter-provider.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/async logout\(\): Promise<void> \{[\s\S]*?async restore\(\): Promise<ProviderSession \| null> \{/, `async logout(): Promise<void> {
    try {
      if (typeof window !== "undefined" && window.puter?.auth?.signOut) {
        await window.puter.auth.signOut();
      }
    } catch (err) {
      console.warn("[puterProvider] SignOut failed:", err instanceof Error ? err.message : err);
    }

    const active = this.accounts.find(a => a.active);
    if (active) {
       await this.removeAccount(active.id);
    } else {
       this.session = createEmptySession("puter");
       await clearSession("puter");
    }

    console.log("[PROVIDER AUTH] Puter session cleared");
  }

  async restore(): Promise<ProviderSession | null> {`);

fs.writeFileSync(file, code);
