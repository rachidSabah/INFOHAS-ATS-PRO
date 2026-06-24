const fs = require('fs');
const file = 'src/lib/providers/puter-provider.ts';
let code = fs.readFileSync(file, 'utf8');

// Replace login method
code = code.replace(/async login\(\): Promise<ProviderSession> \{[\s\S]*?async refresh\(\): Promise<ProviderSession> \{/, `async login(): Promise<ProviderSession> {
    if (typeof window === "undefined" || !window.puter) {
      throw new ProviderAuthenticationError(
        "not_configured",
        "Puter.js is not loaded. Please refresh the page and try again.",
        "puter",
      );
    }

    try {
      // Use Puter's official auth API
      // puter.auth.signIn({ prompt: "select_account" }) opens the OAuth popup
      await window.puter.auth.signIn({ prompt: "select_account" });

      // Get user info after sign-in
      const user = await window.puter.auth.getUser();
      if (!user || !user.username) {
        throw new ProviderAuthenticationError(
          "login_failed",
          "Puter sign-in did not return user information. Please try again.",
          "puter",
        );
      }

      const token = await this.extractAccessToken();

      const newAccount: PuterAccount = {
        id: crypto.randomUUID(),
        email: user.email || \`\${user.username}@puter.com\`,
        userId: String(user.id || user.username),
        accessToken: token,
        refreshToken: null, // Puter manages refresh internally
        expiresAt: Date.now() + SESSION_TTL_MS,
        connectedAt: Date.now(),
        active: true,
        status: "healthy",
      };

      console.log(\`[PUTER]\\nConnected:\\n\${newAccount.email}\`);

      // Deactivate others
      this.accounts.forEach(a => a.active = false);
      // Ensure we don't duplicate emails
      this.accounts = this.accounts.filter(a => a.email !== newAccount.email);
      this.accounts.push(newAccount);

      await this.saveAccounts();
      await this.syncActiveAccountToSession();

      // Notify server
      try {
        await fetch("/api/providers/puter/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: newAccount.email }),
        });
      } catch (e) {}

      return this.session;
    } catch (e: any) {
      if (e instanceof ProviderAuthenticationError) throw e;
      throw new ProviderAuthenticationError(
        "login_failed",
        \`Puter login failed: \${e?.message || "Unknown error"}\`,
        "puter",
      );
    }
  }

  async refresh(): Promise<ProviderSession> {`);

fs.writeFileSync(file, code);
