"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, Icon, ScoreRing } from "@/components/shared";

/**
 * GuardianScoreCard — displays the Structure Guardian validation result.
 *
 * Shows:
 *   - Score ring (0-100 with color coding: red < 60, yellow < 80, green >= 80)
 *   - Status badge: PASS / REQUIRES_MANUAL_REVIEW / BLOCKED
 *   - List of checks that passed/failed
 */

export interface GuardianCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface GuardianScoreCardProps {
  /** Guardian validation score (0-100) */
  score: number;
  /** Overall guardian status */
  status: "PASS" | "REQUIRES_MANUAL_REVIEW" | "BLOCKED";
  /** Individual checks from the guardian */
  checks: GuardianCheck[];
}

export function GuardianScoreCard({ score, status, checks }: GuardianScoreCardProps) {
  const passedCount = checks.filter((c) => c.passed).length;
  const failedCount = checks.length - passedCount;

  const statusVariant =
    status === "PASS" ? "success" :
    status === "REQUIRES_MANUAL_REVIEW" ? "warning" : "danger";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Icon name="Shield" className="w-4 h-4 text-brand" />
          Structure Guardian
          <Badge variant={statusVariant} className="ml-auto text-[10px]">
            {status === "PASS" ? "PASS" :
             status === "REQUIRES_MANUAL_REVIEW" ? "REQUIRES REVIEW" : "BLOCKED"}
          </Badge>
        </CardTitle>
        <CardDescription className="text-xs">
          Validates final resume for corruption, duplicates, and malformed fragments
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        <div className="flex items-center justify-center">
          <ScoreRing value={score} size={100} label="Guardian Score" />
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-2 gap-2 text-xs text-center">
          <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/20 p-2">
            <div className="text-lg font-bold text-emerald-600">{passedCount}</div>
            <div className="text-muted-foreground">Passed</div>
          </div>
          <div className="rounded-lg bg-red-50 dark:bg-red-950/20 p-2">
            <div className="text-lg font-bold text-red-600">{failedCount}</div>
            <div className="text-muted-foreground">Failed</div>
          </div>
        </div>

        {/* Check list */}
        {checks.length > 0 && (
          <div className="space-y-1.5">
            {checks.map((check) => (
              <div key={check.name} className="flex items-center gap-2 text-xs">
                <Icon
                  name={check.passed ? "CheckCircle2" : "AlertCircle"}
                  className={`w-3.5 h-3.5 shrink-0 ${check.passed ? "text-emerald-600" : "text-amber-600"}`}
                />
                <span className="font-medium">{check.name}</span>
                {check.detail && (
                  <span className="text-muted-foreground ml-auto text-[10px]">{check.detail}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
