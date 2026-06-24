const fs = require('fs');
const file = 'src/lib/providers/puter-provider.ts';
let code = fs.readFileSync(file, 'utf8');

const interfaceStr = `
export interface PuterAccount {
  id: string;
  email: string;
  userId: string;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  connectedAt: number;
  active: boolean;
  status: "healthy" | "rate_limited" | "expired" | "disconnected";
  cooldownUntil?: number;
}

`;

if (!code.includes('interface PuterAccount')) {
  code = code.replace(/export class PuterProvider implements OAuthAIProvider \{/, interfaceStr + 'export class PuterProvider implements OAuthAIProvider {\n  public accounts: PuterAccount[] = [];\n  public autoRotate: boolean = true;\n  public useGlobally: boolean = false;\n');
}

fs.writeFileSync(file, code);
