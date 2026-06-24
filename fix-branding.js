const fs = require('fs');
const file = 'workers/api/index.ts';
let code = fs.readFileSync(file, 'utf8');

// We need to fetch the existing row to prevent NOT NULL constraint failures 
// if the client only sends a partial update (like { optimizerDirective: {...} })

code = code.replace(/app\.put\("\/api\/settings\/branding", async \(c\) => \{[\s\S]*?const values: any\[\] = \[[\s\S]*?\];/, `app.put("/api/settings/branding", async (c) => {
  const body = await parseBody(c.req.raw);
  const now = new Date().toISOString();

  let existing: any = {};
  try {
    existing = await c.env.DB.prepare("SELECT * FROM branding WHERE id = 1").first() || {};
  } catch (e) {}

  const n = (bodyValue: any, dbField: string) => bodyValue !== undefined ? bodyValue : (existing[dbField] ?? null);

  const updates: string[] = [
    "app_name = ?", "tagline = ?", "primary_color = ?", "accent_color = ?",
    "logo_url = ?", "email_from_name = ?", "email_from_address = ?",
    "pdf_footer_text = ?", "updated_at = ?",
    "provider_settings_json = ?", "ai_routing_settings_json = ?",
  ];
  const values: any[] = [
    n(body.appName, "app_name") || "ResumeAI Pro", // Enforce NOT NULL default
    n(body.tagline, "tagline"), n(body.primaryColor, "primary_color"), n(body.accentColor, "accent_color"),
    n(body.logoUrl, "logo_url"), n(body.emailFromName, "email_from_name"), n(body.emailFromAddress, "email_from_address"),
    n(body.pdfFooterText, "pdf_footer_text"), now,
    body.providerSettings !== undefined ? JSON.stringify(body.providerSettings) : existing.provider_settings_json,
    body.aiRoutingSettings !== undefined ? JSON.stringify(body.aiRoutingSettings) : existing.ai_routing_settings_json,
  ];`);

fs.writeFileSync(file, code);
