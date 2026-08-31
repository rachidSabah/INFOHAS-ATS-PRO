/**
 * Task 30 — ZaiWebCredentialStore
 *
 * STORAGE RULES (spec-critical):
 *   The zai_web_session credential is NEVER written to localStorage,
 *   IndexedDB, plaintext DB fields, URLs, or logs. The store keeps it in
 *   MEMORY only and, when the secure server sink is available, in the D1
 *   provider_tokens table encrypted with AES-256-GCM (server-side key).
 *
 *   Fail-closed: if the secure sink is unavailable the credential stays
 *   memory-only (session-scoped) and the UI tells the user so — the system
 *   never downgrades to plaintext persistence.
 */

import { ZAI_WEB_CREDENTIAL_TYPE, ZAI_WEB_PROVIDER_ID, type ZaiWebSession } from "./session-discovery";

export interface ZaiWebCredentialRecord {
  providerId: typeof ZAI_WEB_PROVIDER_ID;
  credentialType: typeof ZAI_WEB_CREDENTIAL_TYPE;
  encryptedValue: string; // ciphertext produced server-side
  expiresAt?: number;
  createdAt: number;
  updatedAt: number;
}

export type SecureSinkResult =
  | { stored: "server"; record: ZaiWebCredentialRecord }
  | { stored: "memory-only"; reason: string };

/** Injectable server sink (the edge import route or a Worker binding). */
export interface ZaiWebSecureSink {
  store(session: ZaiWebSession): Promise<{ ok: true } | { ok: false; reason: string }>;
  clear(): Promise<void>;
}

const memorySessions = new Map<string, ZaiWebSession>();

export function rememberZaiWebSession(session: ZaiWebSession): void {
  memorySessions.set(ZAI_WEB_PROVIDER_ID, session);
}

export function recallZaiWebSession(): ZaiWebSession | null {
  return memorySessions.get(ZAI_WEB_PROVIDER_ID) ?? null;
}

export async function persistZaiWebSession(
  session: ZaiWebSession,
  sink: ZaiWebSecureSink,
): Promise<SecureSinkResult> {
  rememberZaiWebSession(session);
  const result = await sink.store(session);
  if (result.ok) {
    return {
      stored: "server",
      record: {
        providerId: ZAI_WEB_PROVIDER_ID,
        credentialType: ZAI_WEB_CREDENTIAL_TYPE,
        encryptedValue: "[stored server-side]", // ciphertext never leaves the sink
        expiresAt: session.expiresAt,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    };
  }
  return { stored: "memory-only", reason: result.reason };
}

export async function forgetZaiWebSession(sink: ZaiWebSecureSink): Promise<void> {
  memorySessions.delete(ZAI_WEB_PROVIDER_ID);
  await sink.clear();
}
