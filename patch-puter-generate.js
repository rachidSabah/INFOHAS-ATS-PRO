const fs = require('fs');
const file = 'src/lib/providers/puter-provider.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/async restore\(\): Promise<ProviderSession \| null> \{[\s\S]*?async listModels\(\): Promise<string\[\]> \{/, `async restore(): Promise<ProviderSession | null> {
    await this.loadAccounts();
    await this.syncActiveAccountToSession();
    
    if (!this.session.authenticated) {
      return null;
    }

    // Check if session is expired
    if (isSessionExpired(this.session)) {
      // Try to refresh
      try {
        const refreshed = await this.refresh();
        console.log("[PROVIDER AUTH] session restored (refreshed)");
        return refreshed;
      } catch (err) {
        console.warn("[puterProvider] Session refresh failed:", err instanceof Error ? err.message : err);
        // Refresh failed — mark active account as expired
        const active = this.accounts.find(a => a.active);
        if (active) {
           active.status = "expired";
           await this.saveAccounts();
           await this.syncActiveAccountToSession();
        }
        console.log("[PROVIDER AUTH] session expired");
        return this.session;
      }
    }

    // Proactively refresh if expiring soon
    if (isSessionExpiringSoon(this.session)) {
      this.refresh().catch(() => {});
    }

    console.log("[PROVIDER AUTH] session restored");
    return this.session;
  }

  async listModels(): Promise<string[]> {`);

code = code.replace(/async generate\(opts: \{[\s\S]*?\): Promise<\{ text: string; provider: string; latencyMs: number \}> \{[\s\S]*?async tryRefresh\(\): Promise<boolean> \{/, `async generate(opts: {
    systemPrompt?: string;
    userPrompt: string;
    maxTokens?: number;
    temperature?: number;
    model?: string;
  }): Promise<{ text: string; provider: string; latencyMs: number }> {
    // AUTH CHECK — no silent fallback
    if (!this.isAuthenticated()) {
      throw new ProviderAuthenticationError(
        "auth_required",
        "Puter authentication required. Please sign in from Provider Settings.",
        "puter",
      );
    }

    if (typeof window === "undefined" || !window.puter?.ai?.chat) {
      throw new ProviderAuthenticationError(
        "not_configured",
        "Puter.js is not available. Please refresh the page.",
        "puter",
      );
    }

    let attempts = 0;
    while (attempts <= this.accounts.length) {
      const t0 = performance.now();

      const messages = opts.systemPrompt
        ? [
            { role: "system", content: opts.systemPrompt },
            { role: "user", content: opts.userPrompt },
          ]
        : [{ role: "user", content: opts.userPrompt }];

      const chatOpts: any = {
        max_tokens: opts.maxTokens ?? 4096,
        temperature: opts.temperature ?? 0.7,
      };
      if (opts.model) {
        chatOpts.model = opts.model;
      }

      try {
        const resp: any = await window.puter.ai.chat(messages, chatOpts);

        // Parse the response
        let text = "";
        if (typeof resp === "string") {
          text = resp;
        } else if (resp?.message?.content) {
          text = Array.isArray(resp.message.content)
            ? resp.message.content.map((c: any) => c?.text ?? "").join("")
            : String(resp.message.content);
        } else if (resp?.text) {
          text = resp.text;
        } else if (resp?.message?.role === "assistant" && typeof resp.message.content === "string") {
          text = resp.message.content;
        } else if (resp?.toString && typeof resp.toString === "function") {
          const str = resp.toString();
          if (str && str !== "[object Object]") text = str;
        }

        if (!text) {
          try { text = JSON.stringify(resp); } catch (err) { console.warn("[puterProvider] Response JSON.stringify failed:", err instanceof Error ? err.message : err); text = String(resp ?? ""); }
        }

        if (attempts > 0) {
           console.log("[PUTER]\\nRetry successful.");
        }

        return {
          text,
          provider: "Puter.js",
          latencyMs: Math.round(performance.now() - t0),
        };
      } catch (e: any) {
        const msg = e?.message || String(e);
        if (/429|quota|rate limit|usage exhausted/i.test(msg)) {
           console.log("[PUTER]\\nRate limit detected.");
           const active = this.accounts.find(a => a.active);
           if (active) {
             active.status = "rate_limited";
             active.cooldownUntil = Date.now() + 60 * 60 * 1000; // 1 hour
             await this.saveAccounts();
           }
           
           const rotated = await this.rotateToNextHealthyAccount();
           if (rotated) {
             attempts++;
             continue; // Retry with next account
           }
        }
        throw e;
      }
    }

    throw new ProviderAuthenticationError(
      "quota_exhausted",
      "All Puter accounts have exhausted their quota or reached rate limits.",
      "puter"
    );
  }

  getStatus(): ProviderAuthStatus {
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
    };
  }

  isAuthenticated(): boolean {
    if (!this.session.authenticated) return false;
    if (isSessionExpired(this.session)) {
      return false;
    }
    return true;
  }

  async tryRefresh(): Promise<boolean> {`);

fs.writeFileSync(file, code);
