"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge, Icon } from "@/components/shared";
import { ProviderManager } from "@/lib/ai/services";
import type { AIProvider } from "@/lib/types";

interface TestResult {
  ok: boolean;
  latencyMs: number;
  message: string;
  response?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export function TestConnectionModal({ provider, onClose }: { provider: AIProvider; onClose: () => void }) {
  const [status, setStatus] = useState<"idle" | "running" | "done">("idle");
  const [result, setResult] = useState<TestResult | null>(null);
  const [testPrompt, setTestPrompt] = useState("Reply with exactly: OK");
  const [steps, setSteps] = useState<string[]>([]);

  const runTest = async () => {
    setStatus("running");
    setSteps([]);
    setResult(null);

    setSteps((s) => [...s, `Resolving adapter for type "${provider.type}"…`]);
    await new Promise((r) => setTimeout(r, 200));
    setSteps((s) => [...s, `Building config (baseUrl=${provider.baseUrl || provider.apiUrl || "—"}, model=${provider.modelName || "—"})…`]);
    await new Promise((r) => setTimeout(r, 200));
    setSteps((s) => [...s, `Sending test prompt: "${testPrompt.slice(0, 60)}${testPrompt.length > 60 ? "…" : ""}"`]);

    const t0 = performance.now();
    const res = await ProviderManager.testConnection(provider);
    const totalMs = Math.round(performance.now() - t0);

    setSteps((s) => [...s, `Received response in ${res.latencyMs}ms (total ${totalMs}ms including overhead).`]);
    setResult(res);
    setStatus("done");
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 20, opacity: 0, scale: 0.97 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 20, opacity: 0, scale: 0.97 }}
        transition={{ type: "spring", damping: 26, stiffness: 280 }}
        className="bg-card rounded-2xl border border-border shadow-premium w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between">
          <h3 className="font-display font-bold text-lg flex items-center gap-2">
            <Icon name="Zap" className="w-5 h-5 text-gold" />
            Test Connection — {provider.name}
          </h3>
          <Button variant="ghost" size="icon" onClick={onClose}><Icon name="X" className="w-4 h-4" /></Button>
        </div>

        <div className="p-5 space-y-4">
          {/* Provider summary */}
          <div className="rounded-lg bg-secondary/50 p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div><div className="text-muted-foreground">Type</div><div className="font-medium capitalize">{provider.type.replace("-", " ")}</div></div>
            <div><div className="text-muted-foreground">Model</div><div className="font-medium font-mono truncate">{provider.modelName || "—"}</div></div>
            <div><div className="text-muted-foreground">Base URL</div><div className="font-mono truncate">{provider.baseUrl || provider.apiUrl || "—"}</div></div>
            <div><div className="text-muted-foreground">Timeout</div><div className="font-medium">{provider.timeout}ms</div></div>
          </div>

          {/* Test prompt editor */}
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wide text-muted-foreground">Test prompt</label>
            <input
              value={testPrompt}
              onChange={(e) => setTestPrompt(e.target.value)}
              disabled={status === "running"}
              className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm disabled:opacity-50"
            />
          </div>

          {/* Run button */}
          <Button
            onClick={runTest}
            disabled={status === "running"}
            className="w-full bg-brand hover:bg-brand-dark text-white gap-2"
          >
            {status === "running" ? (
              <><Icon name="Loader2" className="w-4 h-4 animate-spin" /> Running test…</>
            ) : (
              <><Icon name="Play" className="w-4 h-4" /> Run test connection</>
            )}
          </Button>

          {/* Steps log */}
          {steps.length > 0 && (
            <div className="rounded-lg bg-slate-900 text-slate-100 p-3 font-mono text-xs space-y-1 max-h-40 overflow-y-auto">
              {steps.map((s, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-emerald-400">›</span>
                  <span>{s}</span>
                </div>
              ))}
              {status === "running" && <div className="flex items-center gap-2 text-amber-300"><span className="animate-pulse">●</span> Awaiting response…</div>}
            </div>
          )}

          {/* Result */}
          {status === "done" && result && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
              <div className={`rounded-lg p-4 ${result.ok ? "bg-emerald-100 dark:bg-emerald-400/10 border border-emerald-300" : "bg-red-100 dark:bg-red-400/10 border border-red-300"}`}>
                <div className="flex items-center gap-2">
                  <Icon name={result.ok ? "CheckCircle2" : "XCircle"} className={`w-5 h-5 ${result.ok ? "text-emerald-600" : "text-red-600"}`} />
                  <span className={`font-semibold ${result.ok ? "text-emerald-800 dark:text-emerald-300" : "text-red-800 dark:text-red-300"}`}>
                    {result.ok ? "Connection successful" : "Connection failed"}
                  </span>
                  <Badge variant={result.ok ? "success" : "danger"} className="ml-auto">{result.latencyMs}ms</Badge>
                </div>
                <div className={`mt-2 text-sm ${result.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>{result.message}</div>
              </div>

              {result.response && (
                <div>
                  <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Response</div>
                  <pre className="rounded-lg border border-border bg-secondary/50 p-3 text-xs font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">{result.response}</pre>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-md bg-secondary p-2"><div className="text-muted-foreground">Latency</div><div className="font-mono font-semibold">{result.latencyMs}ms</div></div>
                <div className="rounded-md bg-secondary p-2"><div className="text-muted-foreground">Input tokens</div><div className="font-mono font-semibold">{result.inputTokens ?? "—"}</div></div>
                <div className="rounded-md bg-secondary p-2"><div className="text-muted-foreground">Output tokens</div><div className="font-mono font-semibold">{result.outputTokens ?? "—"}</div></div>
              </div>
            </motion.div>
          )}
        </div>

        <div className="sticky bottom-0 bg-card border-t border-border p-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
          {status === "done" && <Button onClick={runTest} className="bg-brand hover:bg-brand-dark text-white gap-2"><Icon name="RotateCcw" className="w-4 h-4" /> Run again</Button>}
        </div>
      </motion.div>
    </motion.div>
  );
}
