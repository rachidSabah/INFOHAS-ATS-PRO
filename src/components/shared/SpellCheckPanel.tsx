"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, Icon } from "@/components/shared";
import { type SectionSpelling, scanResume, totalMisspelled } from "@/lib/spellchecker";
import type { ResumeData } from "@/lib/types";

interface Props {
  resume: ResumeData;
  onFixWord?: (path: string, oldWord: string, newWord: string) => void;
  open: boolean;
  onToggle: () => void;
}

/**
 * SpellCheckPanel — scans the entire resume for spelling mistakes and
 * presents them in a searchable, actionable panel. Each issue shows the
 * misspelled word in context with clickable suggestions.
 */
export function SpellCheckPanel({ resume, onFixWord, open, onToggle }: Props) {
  const [sections] = useState<SectionSpelling[]>(() => scanResume(resume));
  const total = totalMisspelled(sections);

  if (!open) {
    // Just the badge button
    return (
      <Button
        variant={total > 0 ? "outline" : "ghost"}
        size="sm"
        onClick={onToggle}
        className={`gap-1.5 h-8 relative ${total > 0 ? "border-amber-400 text-amber-600 hover:bg-amber-50" : ""}`}
        title={total > 0 ? `${total} spelling issue${total > 1 ? "s" : ""} found` : "No spelling issues found"}
      >
        <Icon name="SpellCheck2" className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Spelling</span>
        {total > 0 && (
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-400 text-white text-[10px] font-bold leading-none">
            {total}
          </span>
        )}
        {total === 0 && (
          <Icon name="Check" className="w-3 h-3 text-emerald-500" />
        )}
      </Button>
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        exit={{ opacity: 0, height: 0 }}
        className="overflow-hidden"
      >
        <Card className="border-amber-200 bg-amber-50/30">
          <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Icon name="SpellCheck2" className="w-4 h-4 text-amber-600" />
                Spell Check
                {total > 0 ? (
                  <Badge variant="danger" className="text-[10px]">
                    {total} issue{total > 1 ? "s" : ""}
                  </Badge>
                ) : (
                  <Badge variant="default" className="text-[10px] bg-emerald-500">
                    All clear
                  </Badge>
                )}
              </CardTitle>
              {total > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Click a suggestion to replace the word. Re-run after editing.
                </p>
              )}
            </div>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => {
                // Re-scan (force re-mount by toggling)
                onToggle();
                setTimeout(() => onToggle(), 50);
              }}>
                <Icon name="RefreshCw" className="w-3 h-3 mr-1" /> Re-scan
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onToggle}>
                <Icon name="X" className="w-3 h-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            {total === 0 ? (
              <div className="flex items-center gap-2 py-3 text-sm text-emerald-600">
                <Icon name="CheckCircle2" className="w-4 h-4" />
                No spelling issues found. Your resume looks great!
              </div>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                {sections.map((section, si) => (
                  <div key={si}>
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 mt-2 first:mt-0">
                      {section.label}
                    </div>
                    {section.issues.map((issue, ii) => (
                      <div
                        key={ii}
                        className="flex items-start gap-2 py-1.5 px-2 rounded hover:bg-amber-100/50 group"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="text-sm font-mono bg-red-100 text-red-700 px-1 rounded line-through">
                            {issue.word}
                          </span>
                          <span className="text-xs text-muted-foreground ml-2 italic truncate block sm:inline">
                            {issue.context}
                          </span>
                        </div>
                        <div className="flex gap-1 flex-shrink-0 flex-wrap">
                          {issue.suggestions.length > 0 ? (
                            issue.suggestions.slice(0, 3).map((sug) => (
                              <button
                                key={sug}
                                className="text-xs px-2 py-0.5 rounded bg-white border border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:border-emerald-400 transition-colors whitespace-nowrap"
                                onClick={() => {
                                  if (onFixWord && issue.path) {
                                    onFixWord(issue.path, issue.word, sug);
                                  }
                                }}
                                title={`Replace "${issue.word}" with "${sug}"`}
                              >
                                {sug}
                              </button>
                            ))
                          ) : (
                            <span className="text-[10px] text-muted-foreground italic">No suggestions</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
          {total > 0 && (
            <CardFooter className="pt-2 pb-3 px-4">
              <p className="text-[10px] text-muted-foreground">
                Suggestion quality is based on word-level checks — proper nouns, brand names, and technical
                terms may be flagged. Use your judgment when accepting suggestions.
              </p>
            </CardFooter>
          )}
        </Card>
      </motion.div>
    </AnimatePresence>
  );
}
