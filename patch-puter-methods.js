const fs = require('fs');
const file = 'src/lib/providers/puter-provider.ts';
let code = fs.readFileSync(file, 'utf8');

// Add encrypt/decrypt import
if (!code.includes('encryptValue')) {
  code = code.replace(/import \{ saveSession, loadSession, clearSession, isSessionExpired, isSessionExpiringSoon \} from "\.\/session-manager";/, `import { saveSession, loadSession, clearSession, isSessionExpired, isSessionExpiringSoon, encryptValue, decryptValue } from "./session-manager";`);
}

const methodsStr = `
  async saveAccounts(): Promise<void> {
    const encrypted = await Promise.all(this.accounts.map(async (a) => ({
      ...a,
      accessToken: await encryptValue(a.accessToken),
      refreshToken: await encryptValue(a.refreshToken),
    })));
    localStorage.setItem("puter_sessions", JSON.stringify({ accounts: encrypted, autoRotate: this.autoRotate, useGlobally: this.useGlobally }));
    
    // Attempt to sync to KV / D1 via API endpoint
    try {
      await fetch("/api/providers/puter/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts: encrypted, autoRotate: this.autoRotate, useGlobally: this.useGlobally }),
      });
    } catch (e) {
      console.warn("Failed to sync puter accounts to API:", e);
    }
  }

  async loadAccounts(): Promise<void> {
    try {
      // First try API
      let data = null;
      try {
        const res = await fetch("/api/providers/puter/accounts");
        if (res.ok) {
          const apiData = await res.json();
          if (apiData.accounts) {
            data = apiData;
          }
        }
      } catch (e) {
        console.warn("Failed to load puter accounts from API, falling back to localStorage:", e);
      }

      if (!data) {
        const raw = localStorage.getItem("puter_sessions");
        if (raw) data = JSON.parse(raw);
      }

      if (data && Array.isArray(data.accounts)) {
        this.accounts = await Promise.all(data.accounts.map(async (a: any) => ({
          ...a,
          accessToken: await decryptValue(a.accessToken),
          refreshToken: await decryptValue(a.refreshToken),
        })));
        this.autoRotate = data.autoRotate ?? true;
        this.useGlobally = data.useGlobally ?? false;
      }
    } catch (e) {
      console.error("Failed to load Puter accounts:", e);
    }
  }

  async setActiveAccount(id: string): Promise<void> {
    this.accounts.forEach(a => {
      a.active = (a.id === id);
    });
    await this.saveAccounts();
    await this.syncActiveAccountToSession();
    
    try {
      await fetch("/api/providers/puter/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch (e) {}
  }

  async removeAccount(id: string): Promise<void> {
    const wasActive = this.accounts.find(a => a.id === id)?.active;
    this.accounts = this.accounts.filter(a => a.id !== id);
    if (wasActive && this.accounts.length > 0) {
      this.accounts[0].active = true;
    }
    await this.saveAccounts();
    await this.syncActiveAccountToSession();

    try {
      await fetch("/api/providers/puter/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch (e) {}
  }

  async rotateToNextHealthyAccount(): Promise<boolean> {
    if (!this.autoRotate) return false;
    const currentIndex = this.accounts.findIndex(a => a.active);
    for (let i = 1; i <= this.accounts.length; i++) {
      const nextIndex = (currentIndex + i) % this.accounts.length;
      const account = this.accounts[nextIndex];
      // Check cooldowns
      if (account.status === "rate_limited" && account.cooldownUntil && Date.now() > account.cooldownUntil) {
        account.status = "healthy";
        account.cooldownUntil = undefined;
      }
      if (account.status === "healthy" && !account.active) {
        console.log(\`[PUTER] Auto rotating account.\\n[PUTER] Switched: \${account.email}\`);
        await this.setActiveAccount(account.id);
        
        try {
          await fetch("/api/providers/puter/rotate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: account.id }),
          });
        } catch (e) {}
        
        return true;
      }
    }
    return false;
  }

  async syncActiveAccountToSession(): Promise<void> {
    const active = this.accounts.find(a => a.active);
    if (active) {
      // Inject token into window.puter if supported, otherwise just update session
      try {
        if (typeof window !== "undefined" && window.puter?.setAuthToken) {
           window.puter.setAuthToken(active.accessToken);
        } else if (typeof window !== "undefined" && window.puter) {
           // Fallback to internal token property if setAuthToken doesn't exist
           window.puter.authToken = active.accessToken;
        }
      } catch (e) {}

      this.session.authenticated = true;
      this.session.email = active.email;
      this.session.userId = active.userId;
      this.session.accessToken = active.accessToken;
      this.session.refreshToken = active.refreshToken;
      this.session.expiresAt = active.expiresAt;
      this.session.connectedAt = active.connectedAt;
      this.session.authMethod = "puter_oauth";
    } else {
      this.session.authenticated = false;
      this.session.email = null;
      this.session.userId = null;
      this.session.accessToken = null;
      this.session.expiresAt = null;
    }
    await saveSession(this.session);
  }
`;

if (!code.includes('saveAccounts()')) {
  // insert before login()
  code = code.replace(/async login\(\): Promise<ProviderSession> \{/, methodsStr + '\n  async login(): Promise<ProviderSession> {');
}

fs.writeFileSync(file, code);
