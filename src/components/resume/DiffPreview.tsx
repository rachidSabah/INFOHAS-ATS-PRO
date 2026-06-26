"use client";

import { useState, useMemo } from "react";
import type { ResumeData } from "@/lib/types";
import { Icon, Badge } from "@/components/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";

// ── Types ──────────────────────────────────────────────────────────

type SectionKey = "summary" | "experience" | "education" | "skills" | "languages";
type ViewMode = "side-by-side" | "unified";

interface DiffToken {
  text: string;
  type: "same" | "added" | "removed";
}

// ── Word-level LCS diff ────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [];
}

function computeDiff(original: string, optimized: string): DiffToken[] {
  const a = tokenize(original);
  const b = tokenize(optimized);
  const m = a.length;
  const n = b.length;

  // Build LCS table (compact: only keep prev row for memory)
  let prev = new Array(n + 1).fill(0);
  let curr = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(curr[j - 1], prev[j]);
    }
    [prev, curr] = [curr, prev];
  }

  // Backtrack using the first row of optimised DP (we rebuild on demand)
  // For simplicity with short strings, rebuild full table for backtrack
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const result: DiffToken[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.push({ text: a[i - 1], type: "same" });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ text: b[j - 1], type: "added" });
      j--;
    } else {
      result.push({ text: a[i - 1], type: "removed" });
      i--;
    }
  }
  return result.reverse();
}

// ── Diff renderers ─────────────────────────────────────────────────

function DiffText({ tokens }: { tokens: DiffToken[] }) {
  if (tokens.length === 0) {
    return <span className="text-muted-foreground italic">(empty)</span>;
  }
  return (
    <>
      {tokens.map((t, i) => {
        if (t.type === "same") {
          return <span key={i}>{t.text}</span>;
        }
        const cls =
          t.type === "added"
            ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200 rounded-sm"
            : "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 rounded-sm line-through";
        return (
          <span key={i} className={cls}>
            {t.text}
          </span>
        );
      })}
    </>
  );
}

function ChangedBadge({
  change,
}: {
  change: "added" | "removed" | "modified";
}) {
  const map = {
    added: { label: "+", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" },
    removed: { label: "−", cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" },
    modified: { label: "~", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
  };
  const { label, cls } = map[change];
  return (
    <span
      className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold shrink-0 ${cls}`}
      title={change}
    >
      {label}
    </span>
  );
}

// ── Section: Summary ───────────────────────────────────────────────

function SummaryDiff({
  original,
  optimized,
  mode,
}: {
  original: ResumeData;
  optimized: ResumeData;
  mode: ViewMode;
}) {
  const origSummary = original.summary ?? "";
  const optSummary = optimized.summary ?? "";
  const diff = useMemo(() => computeDiff(origSummary, optSummary), [origSummary, optSummary]);

  if (mode === "unified") {
    return (
      <div className="text-sm leading-relaxed">
        <DiffText tokens={diff} />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="text-sm space-y-2">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Original</div>
        <div className="p-3 rounded-lg bg-secondary/40 leading-relaxed">{origSummary || <span className="text-muted-foreground italic">(empty)</span>}</div>
      </div>
      <div className="text-sm space-y-2">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Optimized</div>
        <div className="p-3 rounded-lg bg-secondary/40 leading-relaxed">{optSummary || <span className="text-muted-foreground italic">(empty)</span>}</div>
      </div>
    </div>
  );
}

// ── Section: Experience ────────────────────────────────────────────

function ExperienceDiff({
  original,
  optimized,
  mode,
}: {
  original: ResumeData;
  optimized: ResumeData;
  mode: ViewMode;
}) {
  const items = useMemo(() => {
    const origById = new Map(original.experience.map((e) => [e.id, e]));
    const optById = new Map(optimized.experience.map((e) => [e.id, e]));
    const allIds = new Set([...origById.keys(), ...optById.keys()]);

    return Array.from(allIds).map((id) => {
      const o = origById.get(id);
      const n = optById.get(id);
      const change: "added" | "removed" | "modified" | "same" = !o ? "added" : !n ? "removed" : JSON.stringify(o) === JSON.stringify(n) ? "same" : "modified";
      return { id, orig: o, next: n, change };
    });
  }, [original, optimized]);

  if (items.length === 0) {
    return <div className="text-sm text-muted-foreground italic py-4 text-center">No experience entries to compare.</div>;
  }

  if (mode === "side-by-side") {
    return (
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-3">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Original</div>
          {items
            .filter((i) => i.orig)
            .map((i) => (
              <ExpCard key={i.id} item={i.orig!} change={i.change} showChange={i.change !== "same"} />
            ))}
          {items.filter((i) => !i.orig).length > 0 && !items.some((i) => i.orig) && (
            <div className="text-sm text-muted-foreground italic">(none)</div>
          )}
        </div>
        <div className="space-y-3">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Optimized</div>
          {items
            .filter((i) => i.next)
            .map((i) => (
              <ExpCard key={i.id} item={i.next!} change={i.change} showChange={i.change !== "same"} />
            ))}
          {items.filter((i) => !i.next).length > 0 && !items.some((i) => i.next) && (
            <div className="text-sm text-muted-foreground italic">(none)</div>
          )}
        </div>
      </div>
    );
  }

  // Unified mode
  return (
    <div className="space-y-3">
      {items.map((i) => {
        if (i.change === "same") {
          return <ExpCard key={i.id} item={i.orig!} change="same" />;
        }
        // Show removed + added as a diff pair
        return (
          <div key={i.id} className="space-y-1.5">
            {i.orig && (
              <div className="relative">
                <div className="absolute top-2 left-2 z-10"><ChangedBadge change="removed" /></div>
                <div className="pl-8 opacity-60">
                  <ExpCard item={i.orig} change="removed" />
                </div>
              </div>
            )}
            {i.next && (
              <div className="relative">
                <div className="absolute top-2 left-2 z-10"><ChangedBadge change="added" /></div>
                <div className="pl-8">
                  <ExpCard item={i.next} change="added" />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ExpCard({
  item,
  change,
  showChange,
}: {
  item: NonNullable<ResumeData["experience"][0]>;
  change: "added" | "removed" | "modified" | "same";
  showChange?: boolean;
}) {
  const borderCls =
    change === "added" ? "border-emerald-300 dark:border-emerald-700" :
    change === "removed" ? "border-red-300 dark:border-red-700" :
    change === "modified" ? "border-amber-300 dark:border-amber-700" :
    "border-border";

  return (
    <div className={`border-l-2 ${borderCls} pl-3 py-1.5 text-sm space-y-1`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="font-semibold">{item.title}</span>
          {item.company && <span className="text-muted-foreground"> @ {item.company}</span>}
        </div>
        <div className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
          {item.startDate} – {item.endDate}
        </div>
      </div>
      {item.location && <div className="text-xs text-muted-foreground">{item.location}</div>}
      {item.bullets.length > 0 && (
        <ul className="list-disc list-inside space-y-0.5 text-xs text-muted-foreground">
          {item.bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Section: Education ─────────────────────────────────────────────

function EducationDiff({
  original,
  optimized,
  mode,
}: {
  original: ResumeData;
  optimized: ResumeData;
  mode: ViewMode;
}) {
  const items = useMemo(() => {
    const origById = new Map(original.education.map((e) => [e.id, e]));
    const optById = new Map(optimized.education.map((e) => [e.id, e]));
    const allIds = new Set([...origById.keys(), ...optById.keys()]);
    return Array.from(allIds).map((id) => {
      const o = origById.get(id);
      const n = optById.get(id);
      const change: "added" | "removed" | "modified" | "same" = !o ? "added" : !n ? "removed" : JSON.stringify(o) === JSON.stringify(n) ? "same" : "modified";
      return { id, orig: o, next: n, change };
    });
  }, [original, optimized]);

  if (items.length === 0) {
    return <div className="text-sm text-muted-foreground italic py-4 text-center">No education entries to compare.</div>;
  }

  if (mode === "side-by-side") {
    return (
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-3">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Original</div>
          {items.filter((i) => i.orig).map((i) => <EduCard key={i.id} item={i.orig!} change={i.change} />)}
        </div>
        <div className="space-y-3">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Optimized</div>
          {items.filter((i) => i.next).map((i) => <EduCard key={i.id} item={i.next!} change={i.change} />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((i) => {
        if (i.change === "same") return <EduCard key={i.id} item={i.orig!} change="same" />;
        return (
          <div key={i.id} className="space-y-1.5">
            {i.orig && (
              <div className="relative">
                <div className="absolute top-2 left-2 z-10"><ChangedBadge change="removed" /></div>
                <div className="pl-8 opacity-60"><EduCard item={i.orig} change="removed" /></div>
              </div>
            )}
            {i.next && (
              <div className="relative">
                <div className="absolute top-2 left-2 z-10"><ChangedBadge change="added" /></div>
                <div className="pl-8"><EduCard item={i.next} change="added" /></div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function EduCard({
  item,
  change,
}: {
  item: NonNullable<ResumeData["education"][0]>;
  change: "added" | "removed" | "modified" | "same";
}) {
  const borderCls =
    change === "added" ? "border-emerald-300 dark:border-emerald-700" :
    change === "removed" ? "border-red-300 dark:border-red-700" :
    change === "modified" ? "border-amber-300 dark:border-amber-700" :
    "border-border";

  return (
    <div className={`border-l-2 ${borderCls} pl-3 py-1.5 text-sm space-y-1`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="font-semibold">{item.degree}</span>
          {item.field && <span className="text-muted-foreground"> in {item.field}</span>}
        </div>
        <div className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
          {item.startDate} – {item.endDate}
        </div>
      </div>
      <div className="text-xs">{item.institution}</div>
      {item.highlights && item.highlights.length > 0 && (
        <ul className="list-disc list-inside space-y-0.5 text-xs text-muted-foreground">
          {item.highlights.map((h, i) => (
            <li key={i}>{h}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Section: Skills ────────────────────────────────────────────────

function SkillsDiff({
  original,
  optimized,
  mode,
}: {
  original: ResumeData;
  optimized: ResumeData;
  mode: ViewMode;
}) {
  const skillDiff = useMemo(() => {
    const origSkills = new Map(original.skills.map((s) => [s.name.toLowerCase(), s]));
    const optSkills = new Map(optimized.skills.map((s) => [s.name.toLowerCase(), s]));
    const allNames = new Set([...origSkills.keys(), ...optSkills.keys()]);

    const added: typeof original.skills = [];
    const removed: typeof original.skills = [];
    const same: typeof original.skills = [];

    for (const name of allNames) {
      const o = origSkills.get(name);
      const n = optSkills.get(name);
      if (o && !n) removed.push(o);
      else if (!o && n) added.push(n);
      else if (o && n) same.push(o);
    }

    return { added, removed, same };
  }, [original, optimized]);

  const hasChanges = skillDiff.added.length > 0 || skillDiff.removed.length > 0;

  if (mode === "side-by-side") {
    return (
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Original</div>
          <div className="flex flex-wrap gap-1.5">
            {original.skills.length === 0 && <span className="text-sm text-muted-foreground italic">(none)</span>}
            {original.skills.map((s) => (
              <span
                key={s.id}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                  !optimized.skills.some((n) => n.name.toLowerCase() === s.name.toLowerCase())
                    ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 line-through"
                    : "bg-secondary text-secondary-foreground"
                }`}
              >
                {s.name}
                {s.category && <span className="opacity-60">({s.category})</span>}
              </span>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Optimized</div>
          <div className="flex flex-wrap gap-1.5">
            {optimized.skills.length === 0 && <span className="text-sm text-muted-foreground italic">(none)</span>}
            {optimized.skills.map((s) => (
              <span
                key={s.id}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                  !original.skills.some((o) => o.name.toLowerCase() === s.name.toLowerCase())
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                    : "bg-secondary text-secondary-foreground"
                }`}
              >
                {s.name}
                {s.category && <span className="opacity-60">({s.category})</span>}
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Unified mode
  return (
    <div className="space-y-3">
      {hasChanges && (
        <div className="flex flex-wrap gap-1.5">
          {skillDiff.added.length > 0 && (
            <div className="w-full text-xs text-emerald-600 dark:text-emerald-400 font-medium mb-1">Added</div>
          )}
          {skillDiff.added.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
            >
              + {s.name}
              {s.category && <span className="opacity-60">({s.category})</span>}
            </span>
          ))}
          {skillDiff.removed.length > 0 && (
            <div className="w-full text-xs text-red-600 dark:text-red-400 font-medium mb-1 mt-2">Removed</div>
          )}
          {skillDiff.removed.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 line-through"
            >
              − {s.name}
              {s.category && <span className="opacity-60">({s.category})</span>}
            </span>
          ))}
        </div>
      )}
      {skillDiff.same.length > 0 && (
        <div>
          <div className="text-xs text-muted-foreground font-medium mb-1">Unchanged ({skillDiff.same.length})</div>
          <div className="flex flex-wrap gap-1.5">
            {skillDiff.same.map((s) => (
              <span
                key={s.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground"
              >
                {s.name}
                {s.category && <span className="opacity-60">({s.category})</span>}
              </span>
            ))}
          </div>
        </div>
      )}
      {!hasChanges && skillDiff.same.length === 0 && (
        <div className="text-sm text-muted-foreground italic py-4 text-center">No skills to compare.</div>
      )}
    </div>
  );
}

// ── Section: Languages ─────────────────────────────────────────────

function LanguagesDiff({
  original,
  optimized,
  mode,
}: {
  original: ResumeData;
  optimized: ResumeData;
  mode: ViewMode;
}) {
  const langDiff = useMemo(() => {
    const origLang = new Map(original.languages.map((l) => [l.name.toLowerCase(), l]));
    const optLang = new Map(optimized.languages.map((l) => [l.name.toLowerCase(), l]));
    const allNames = new Set([...origLang.keys(), ...optLang.keys()]);

    const added: typeof original.languages = [];
    const removed: typeof original.languages = [];
    const modified: { orig: typeof original.languages[0]; next: typeof original.languages[0] }[] = [];
    const same: typeof original.languages = [];

    for (const name of allNames) {
      const o = origLang.get(name);
      const n = optLang.get(name);
      if (o && !n) removed.push(o);
      else if (!o && n) added.push(n);
      else if (o && n) {
        if (o.proficiency !== n.proficiency) modified.push({ orig: o, next: n });
        else same.push(o);
      }
    }

    return { added, removed, modified, same };
  }, [original, optimized]);

  const hasChanges = langDiff.added.length > 0 || langDiff.removed.length > 0 || langDiff.modified.length > 0;

  if (mode === "side-by-side") {
    return (
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Original</div>
          {original.languages.length === 0 && <span className="text-sm text-muted-foreground italic">(none)</span>}
          {original.languages.map((l) => {
            const inOpt = optimized.languages.some((n) => n.name.toLowerCase() === l.name.toLowerCase());
            return (
              <div
                key={l.id}
                className={`flex items-center justify-between text-sm px-2 py-1 rounded ${
                  !inOpt ? "bg-red-100 dark:bg-red-900/30 line-through text-red-700 dark:text-red-300" : ""
                }`}
              >
                <span>{l.name}</span>
                <span className="text-xs text-muted-foreground">{l.proficiency}</span>
              </div>
            );
          })}
        </div>
        <div className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Optimized</div>
          {optimized.languages.length === 0 && <span className="text-sm text-muted-foreground italic">(none)</span>}
          {optimized.languages.map((l) => {
            const inOrig = original.languages.some((o) => o.name.toLowerCase() === l.name.toLowerCase());
            return (
              <div
                key={l.id}
                className={`flex items-center justify-between text-sm px-2 py-1 rounded ${
                  !inOrig ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300" : ""
                }`}
              >
                <span>{l.name}</span>
                <span className="text-xs text-muted-foreground">{l.proficiency}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Unified mode
  return (
    <div className="space-y-2">
      {langDiff.added.length > 0 && (
        <div>
          <div className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mb-1">Added</div>
          {langDiff.added.map((l) => (
            <div
              key={l.id}
              className="flex items-center justify-between text-sm px-2 py-1 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
            >
              <span>+ {l.name}</span>
              <span className="text-xs">{l.proficiency}</span>
            </div>
          ))}
        </div>
      )}
      {langDiff.removed.length > 0 && (
        <div>
          <div className="text-xs text-red-600 dark:text-red-400 font-medium mb-1">Removed</div>
          {langDiff.removed.map((l) => (
            <div
              key={l.id}
              className="flex items-center justify-between text-sm px-2 py-1 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 line-through"
            >
              <span>− {l.name}</span>
              <span className="text-xs">{l.proficiency}</span>
            </div>
          ))}
        </div>
      )}
      {langDiff.modified.length > 0 && (
        <div>
          <div className="text-xs text-amber-600 dark:text-amber-400 font-medium mb-1">Modified</div>
          {langDiff.modified.map((l) => (
            <div
              key={l.orig.id}
              className="flex items-center justify-between text-sm px-2 py-1 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
            >
              <span>
                <span className="line-through opacity-60">{l.orig.name}</span>
                {" → "}
                <span>{l.next.name}</span>
                <span className="text-xs ml-1 text-muted-foreground">({l.orig.proficiency} → {l.next.proficiency})</span>
              </span>
            </div>
          ))}
        </div>
      )}
      {langDiff.same.length > 0 && (
        <div>
          <div className="text-xs text-muted-foreground font-medium mb-1">Unchanged ({langDiff.same.length})</div>
          {langDiff.same.map((l) => (
            <div key={l.id} className="flex items-center justify-between text-sm px-2 py-1">
              <span>{l.name}</span>
              <span className="text-xs text-muted-foreground">{l.proficiency}</span>
            </div>
          ))}
        </div>
      )}
      {!hasChanges && langDiff.same.length === 0 && (
        <div className="text-sm text-muted-foreground italic py-4 text-center">No languages to compare.</div>
      )}
    </div>
  );
}

// ── Section summary counts ─────────────────────────────────────────

function useSectionCounts(original: ResumeData, optimized: ResumeData) {
  return useMemo(() => {
    const sections: Record<SectionKey, number> = {
      summary: (original.summary || "") !== (optimized.summary || "") ? 1 : 0,
      experience: countChanged(original.experience, optimized.experience),
      education: countChanged(original.education, optimized.education),
      skills: countChanged(original.skills, optimized.skills),
      languages: countChanged(original.languages, optimized.languages),
    };
    return sections;
  }, [original, optimized]);
}

function countChanged<T extends { id: string }>(orig: T[], opt: T[]): number {
  const origMap = new Map(orig.map((o) => [o.id, o]));
  const optMap = new Map(opt.map((o) => [o.id, o]));
  let changes = 0;
  const allIds = new Set([...origMap.keys(), ...optMap.keys()]);
  for (const id of allIds) {
    const o = origMap.get(id);
    const n = optMap.get(id);
    if (!o || !n || JSON.stringify(o) !== JSON.stringify(n)) changes++;
  }
  return changes;
}

// ── Main DiffPreview component ─────────────────────────────────────

export function DiffPreview({
  original,
  optimized,
}: {
  original: ResumeData;
  optimized: ResumeData;
}) {
  const [viewMode, setViewMode] = useState<ViewMode>("side-by-side");
  const [activeSection, setActiveSection] = useState<SectionKey>("summary");
  const counts = useSectionCounts(original, optimized);

  const totalChanges = Object.values(counts).reduce((a, b) => a + b, 0);

  const sectionLabel: Record<SectionKey, string> = {
    summary: "Summary",
    experience: "Experience",
    education: "Education",
    skills: "Skills",
    languages: "Languages",
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Icon name="GitCompareArrows" className="w-4 h-4 text-brand" />
          Before / After
          {totalChanges > 0 && (
            <Badge variant="brand" className="ml-1">{totalChanges} change{totalChanges !== 1 ? "s" : ""}</Badge>
          )}
        </CardTitle>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setViewMode("side-by-side")}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
              viewMode === "side-by-side"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary"
            }`}
          >
            <Icon name="Columns2" className="w-3.5 h-3.5 inline mr-1" />
            Side by Side
          </button>
          <button
            type="button"
            onClick={() => setViewMode("unified")}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
              viewMode === "unified"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary"
            }`}
          >
            <Icon name="AlignLeft" className="w-3.5 h-3.5 inline mr-1" />
            Unified
          </button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Tabs
          value={activeSection}
          onValueChange={(v) => setActiveSection(v as SectionKey)}
          className="w-full"
        >
          <div className="px-6">
            <TabsList className="w-full justify-start rounded-none border-b border-border bg-transparent p-0 h-auto">
              {(Object.keys(sectionLabel) as SectionKey[]).map((key) => {
                const count = counts[key];
                return (
                  <TabsTrigger
                    key={key}
                    value={key}
                    className="relative rounded-none border-b-2 border-transparent data-[state=active]:border-primary px-3 py-2 text-xs font-medium data-[state=active]:text-foreground data-[state=active]:shadow-none bg-transparent hover:text-foreground"
                  >
                    {sectionLabel[key]}
                    {count > 0 && (
                      <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-brand/10 text-brand text-[10px] font-bold">
                        {count}
                      </span>
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>

          <ScrollArea className="max-h-[420px]">
            <div className="p-4">
              <TabsContent value="summary" className="mt-0">
                <SummaryDiff original={original} optimized={optimized} mode={viewMode} />
              </TabsContent>

              <TabsContent value="experience" className="mt-0">
                <ExperienceDiff original={original} optimized={optimized} mode={viewMode} />
              </TabsContent>

              <TabsContent value="education" className="mt-0">
                <EducationDiff original={original} optimized={optimized} mode={viewMode} />
              </TabsContent>

              <TabsContent value="skills" className="mt-0">
                <SkillsDiff original={original} optimized={optimized} mode={viewMode} />
              </TabsContent>

              <TabsContent value="languages" className="mt-0">
                <LanguagesDiff original={original} optimized={optimized} mode={viewMode} />
              </TabsContent>
            </div>
          </ScrollArea>
        </Tabs>
      </CardContent>
    </Card>
  );
}
