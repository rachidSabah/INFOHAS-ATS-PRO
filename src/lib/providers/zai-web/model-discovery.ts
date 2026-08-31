/**
 * Task 30 — ZaiWebModelDiscovery
 *
 * Discovers the model catalog exposed by the AUTHENTICATED chat.z.ai web
 * application (which is NOT assumed to equal the official Z.ai API catalog).
 *
 * OWNERSHIP RULE (mirror of Task 29's Antigravity rule): every model
 * discovered through the web session belongs to provider_id = "zai-web"
 * (integration_type = "web-session", source = "zai-web") — even when the id
 * is a GLM-family name that also exists under an official Z.ai API
 * integration. The same model name may legitimately live under both
 * providers; ownership is the integration a model is callable through.
 *
 * Stable row identity: id = "zai-web:<model_id>", keyed on
 * (provider_id, model_id) so repeated Sync Models runs are idempotent
 * upserts — never duplicates (the Task 29 lesson).
 */

import { ZAI_WEB_PROVIDER_ID } from "./session-discovery";

export interface ZaiWebModelRow {
  id: string;
  provider_id: string;
  model_id: string;
  model_name: string;
  enabled: number;
  source: string;
}

export function zaiWebModelUpsert(modelId: string): { sql: string; params: string[] } {
  const trimmed = modelId.trim();
  return {
    sql: `INSERT INTO provider_models (id, provider_id, model_id, model_name, enabled, source)
          VALUES (?, 'zai-web', ?, ?, 1, 'zai-web')
          ON CONFLICT(provider_id, model_id)
          DO UPDATE SET model_name = excluded.model_name`,
    params: [`${ZAI_WEB_PROVIDER_ID}:${trimmed}`, trimmed, trimmed],
  };
}

export function toZaiWebModelRows(modelIds: string[]): ZaiWebModelRow[] {
  return modelIds
    .map((m) => m.trim())
    .filter(Boolean)
    .map((modelId) => ({
      id: `${ZAI_WEB_PROVIDER_ID}:${modelId}`,
      provider_id: ZAI_WEB_PROVIDER_ID,
      model_id: modelId,
      model_name: modelId,
      enabled: 1,
      source: "zai-web",
    }));
}
