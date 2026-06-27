// ============================================================================
// Model Registry & Capability Engine
// Provider-agnostic model catalog with capability profiles for intelligent routing
// ============================================================================

export interface CapabilityProfile {
  reasoningScore: number; writingScore: number; atsScore: number;
  jsonScore: number; speedScore: number; codingScore: number;
  contextScore: number; healthScore: number;
}

export interface ModelEntry {
  id: string; providerId: string; providerName: string; modelName: string;
  contextWindow: number; supportsJSON: boolean; supportsStreaming: boolean;
  capabilities: CapabilityProfile;
  health: { successRate: number; avgLatencyMs: number; errorRate: number;
    rateLimitCount: number; quotaRemaining: number; lastUsed: number; healthScore: number; };
  metadata: Record<string, unknown>;
}

export interface AgentCapabilityWeights {
  reasoningScore: number; writingScore: number; atsScore: number;
  jsonScore: number; speedScore: number; codingScore: number; contextScore: number;
}

export const AGENT_CAPABILITY_WEIGHTS: Record<string, AgentCapabilityWeights> = {
  summary:    { reasoningScore:20, writingScore:35, atsScore:25, jsonScore:5,  speedScore:5,  codingScore:0, contextScore:10 },
  skills:     { reasoningScore:10, writingScore:25, atsScore:15, jsonScore:30, speedScore:10, codingScore:0, contextScore:10 },
  experience: { reasoningScore:30, writingScore:30, atsScore:20, jsonScore:10, speedScore:5,  codingScore:0, contextScore:5 },
  education:  { reasoningScore:10, writingScore:30, atsScore:15, jsonScore:25, speedScore:10, codingScore:0, contextScore:10 },
  languages:  { reasoningScore:5,  writingScore:10, atsScore:10, jsonScore:40, speedScore:25, codingScore:0, contextScore:10 },
  guardian:   { reasoningScore:40, writingScore:10, atsScore:5,  jsonScore:30, speedScore:5,  codingScore:0, contextScore:10 },
  reflection: { reasoningScore:45, writingScore:20, atsScore:5,  jsonScore:15, speedScore:5,  codingScore:0, contextScore:10 },
  memory:     { reasoningScore:5,  writingScore:5,  atsScore:5,  jsonScore:40, speedScore:35, codingScore:0, contextScore:10 },
  router:     { reasoningScore:5,  writingScore:5,  atsScore:5,  jsonScore:30, speedScore:45, codingScore:0, contextScore:10 },
};

const DEFAULT_CAPABILITIES: Record<string, CapabilityProfile> = {
  "claude-opus":   { reasoningScore:92, writingScore:88, atsScore:80, jsonScore:85, speedScore:40, codingScore:90, contextScore:95, healthScore:85 },
  "claude-sonnet": { reasoningScore:85, writingScore:85, atsScore:78, jsonScore:82, speedScore:55, codingScore:85, contextScore:85, healthScore:85 },
  "claude-haiku":  { reasoningScore:72, writingScore:75, atsScore:70, jsonScore:75, speedScore:80, codingScore:72, contextScore:60, healthScore:82 },
  "gpt-5":         { reasoningScore:90, writingScore:87, atsScore:78, jsonScore:85, speedScore:45, codingScore:88, contextScore:85, healthScore:82 },
  "gpt-4o":        { reasoningScore:82, writingScore:82, atsScore:75, jsonScore:82, speedScore:55, codingScore:80, contextScore:75, healthScore:80 },
  "gemini":        { reasoningScore:85, writingScore:80, atsScore:75, jsonScore:78, speedScore:60, codingScore:78, contextScore:90, healthScore:78 },
  "deepseek":      { reasoningScore:80, writingScore:78, atsScore:72, jsonScore:80, speedScore:65, codingScore:82, contextScore:65, healthScore:75 },
  "mistral":       { reasoningScore:78, writingScore:78, atsScore:72, jsonScore:78, speedScore:70, codingScore:75, contextScore:60, healthScore:76 },
  "groq":          { reasoningScore:65, writingScore:65, atsScore:60, jsonScore:70, speedScore:95, codingScore:60, contextScore:55, healthScore:80 },
  "llama":         { reasoningScore:72, writingScore:72, atsScore:68, jsonScore:72, speedScore:65, codingScore:70, contextScore:60, healthScore:72 },
  "qwen":          { reasoningScore:75, writingScore:72, atsScore:68, jsonScore:75, speedScore:62, codingScore:72, contextScore:60, healthScore:72 },
};

function detectModelFamily(name: string): string {
  const l = name.toLowerCase();
  if (l.includes("claude-opus")) return "claude-opus"; if (l.includes("claude-sonnet")) return "claude-sonnet";
  if (l.includes("claude-haiku")) return "claude-haiku"; if (l.includes("claude")) return "claude-sonnet";
  if (l.includes("gpt-5")) return "gpt-5"; if (l.includes("gpt-4")) return "gpt-4o";
  if (l.includes("gemini")) return "gemini"; if (l.includes("deepseek")) return "deepseek";
  if (l.includes("mistral")) return "mistral"; if (l.includes("groq")) return "groq";
  if (l.includes("llama")) return "llama"; if (l.includes("qwen")) return "qwen"; return "llama";
}

function computeWeightedScore(m: ModelEntry, w: AgentCapabilityWeights): number {
  const c = m.capabilities; const h = m.health;
  const tw = w.reasoningScore+w.writingScore+w.atsScore+w.jsonScore+w.speedScore+w.codingScore+w.contextScore;
  if (tw===0) return 0;
  return ((c.reasoningScore*w.reasoningScore+c.writingScore*w.writingScore+c.atsScore*w.atsScore+c.jsonScore*w.jsonScore+c.speedScore*w.speedScore+c.codingScore*w.codingScore+c.contextScore*w.contextScore)/tw)*0.40+h.healthScore*0.25+(1-h.errorRate)*100*0.15+(100-Math.min(h.avgLatencyMs/100,100))*0.10+h.quotaRemaining*100*0.10;
}

function computeHealthScore(h: ModelEntry["health"]): number {
  return h.successRate*100*0.5+Math.max(0,100-h.avgLatencyMs/50)*0.2+Math.max(0,100-h.errorRate*100)*0.2+Math.max(0,100-h.rateLimitCount*5)*0.1;
}

export class ModelRegistry {
  private models: Map<string, ModelEntry> = new Map();

  register(m: ModelEntry): void { this.models.set(m.id, { ...m, health: { ...m.health } }); }
  get(id: string): ModelEntry|undefined { return this.models.get(id); }
  findByProvider(pid: string): ModelEntry[] { const all = Array.from(this.models.values()); return all.filter(m=>m.providerId===pid); }
  getAll(): ModelEntry[] { return Array.from(this.models.values()); }
  size(): number { return this.models.size; }
  clear(): void { this.models.clear(); }

  rankForTask(task: string, minHealth=50): ModelEntry[] {
    const w = AGENT_CAPABILITY_WEIGHTS[task]||AGENT_CAPABILITY_WEIGHTS.router;
    return this.getAll().filter(m=>m.health.healthScore>=minHealth).map(m=>({m,score:computeWeightedScore(m,w)})).sort((a,b)=>b.score-a.score).map(e=>e.m);
  }

  getBestForTask(task: string, minHealth=50): ModelEntry|undefined { return this.rankForTask(task,minHealth)[0]; }

  updateHealth(modelId: string, patch: Partial<ModelEntry["health"]>): void {
    const m = this.models.get(modelId); if (!m) return;
    m.health = { ...m.health, ...patch }; m.health.healthScore = computeHealthScore(m.health);
  }

  importFromProvider(pid: string, pname: string, names: string[], ctxWindows: Record<string,number>={}): number {
    let n=0;
    for (const name of names) {
      const id=`${pid}:${name}`; if (this.models.has(id)) continue;
      const f=detectModelFamily(name); const d=DEFAULT_CAPABILITIES[f]||DEFAULT_CAPABILITIES.llama;
      this.register({
        id, providerId:pid, providerName:pname, modelName:name,
        contextWindow:ctxWindows[name]||8192, supportsJSON:true, supportsStreaming:true,
        capabilities:{...d}, health:{successRate:1.0,avgLatencyMs:0,errorRate:0,rateLimitCount:0,quotaRemaining:1.0,lastUsed:0,healthScore:80}, metadata:{}
      });
      n++;
    }
    return n;
  }
}

export const modelRegistry = new ModelRegistry();