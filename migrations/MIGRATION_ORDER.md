# Migration Order — ResumeAI Pro (Cloudflare D1)

> **RULE: Every migration filename MUST begin with a unique 4-digit prefix.**
> Never create two files with the same prefix. Wrangler applies migrations
> in lexicographic order by filename; duplicate prefixes cause non-deterministic
> schema state.

## Canonical Order (as of 2026-07-11)

| File | Tables / Columns Added | Depends On |
|---|---|---|
| `0001_init.sql` | Core schema: users, sessions, resumes, job_descriptions, ats_reports, cover_letters, interview_packages, ai_providers, prompt_templates, branding, feature_flags, audit_logs | — |
| `0002_ai_providers_enhanced.sql` | ai_providers columns: base_url, streaming_enabled, is_default, cost_*, auth_type, etc. + ai_provider_logs table + ai_provider_settings table | 0001 |
| `0003_fix_section_columns.sql` | resumes: additional_info_json, dynamic_sections_json | 0001 |
| `0004_ai_dev_agent.sql` | ai_agent_settings, ai_agent_history, ai_agent_reports | 0001 |
| `0005_user_access_control.sql` | ai_providers: allowed_for_regular_users | 0002 |
| `0006_provider_classification.sql` | ai_providers: provider_category, supports_*, health_* columns | 0002 |
| `0007_user_management.sql` | users: username, status, last_login_at, updated_at + password_resets table + audit_logs: user_id, performed_by, metadata | 0001 |
| `0008_cloud_migration.sql` | Bulk cloud sync migration (large) | 0001–0007 |
| `0009_provider_settings.sql` | Provider settings additions | 0002 |
| `0010_task_tracking.sql` | ai_tasks table | 0001 |
| `0011_indexes_and_self_healing.sql` | Performance indexes + provider_sync_state table + orphan cleanup | 0001–0010 |
| `0012_username_backfill.sql` | ai_tasks: username column backfill | 0010 |
| `0013_alternate_api_keys.sql` | Alternate API key support | 0002 |
| `0014_career_materials.sql` | career_materials table | 0001 |
| `0015_antigravity_provider.sql` | provider_tokens, provider_connections, provider_models, provider_health, provider_capabilities | 0001 |
| `0016_provider_models_stable_ids.sql` | provider_models stable ids (UNIQUE(provider_id, model_id)) | 0015 |
| `0017_agent_configs_and_sessions.sql` | branding: agent_configs_json/_version/_updated_at/_updated_by + provider_sessions table (Agent Configuration Center D1 persistence + provider session lifecycle) | 0008 |
| `0018_resumes_profile_columns.sql` | (now a no-op) resumes: photo_url, date_of_birth + users: avatar — provided by 0001 on fresh databases; production already has them (0008-born tables) | 0001, 0003 |

## How to Add a New Migration

1. Find the highest current prefix number (currently `0015`).
2. Name your file `0016_description_of_change.sql`.
3. Update this table above.
4. Run `npx wrangler d1 migrations apply resumeai-pro-db --remote` to apply.

## CI Guard

The CI pipeline (`.github/workflows/`) should run this check before deploy:

```bash
# Fail if any two migration files share a numeric prefix
cd migrations
duplicates=$(ls *.sql | sed 's/_.*//' | sort | uniq -d)
if [ -n "$duplicates" ]; then
  echo "ERROR: Duplicate migration prefixes detected: $duplicates"
  exit 1
fi
echo "Migration prefixes: OK"
```

## Security Note — 0007_user_management.sql

`0007_user_management.sql` contains a plaintext password stub in the seed INSERT.
This was present in the original `0004_user_management.sql`. The stub comment
references a production password value that must be treated as **compromised**.

**Required action before production deploy:**
1. Delete or replace the seed INSERT in `0007_user_management.sql` with a proper
   bcrypt hash generated at deploy time, or remove the seed entirely and create
   the super admin account via the admin UI after first deploy.
2. Rotate any credentials matching the value referenced in that file.
