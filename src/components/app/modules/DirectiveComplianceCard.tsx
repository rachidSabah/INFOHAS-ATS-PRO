"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, Icon, ScoreRing } from "@/components/shared";

/**
 * DirectiveComplianceCard — displays how well the output follows the OptimizationPolicy.
 *
 * Shows:
 *   - Compliance score ring
 *   - Pass/Fail status
 *   - Per-check breakdown (7 checks)
 */

export interface ComplianceCheck {
  check: string;
  passed: boolean;
  detail?: string;
}

export interface DirectiveComplianceCardProps {
  /** Compliance score (0-100) */
  complianceScore: number;
  /** Whether overall compliance passed */
  passed: boolean;
  /** Individual compliance checks */
  checks: ComplianceCheck[];
}

export function DirectiveComplianceCard({ complianceScore, passed, checks }: DirectiveComplianceCardProps) {
  const passedCount = checks.filter((c) => c.passed).length;
  const totalCount = checks.length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Icon name="FileCheck" className="w-4 h-4 text-brand" />
          Directive Compliance
          <Badge variant={passed ? "success" : "warning"} className="ml-auto text-[10px]">
            {passed ? "PASS" : "FAIL"}
          </Badge>
        </CardTitle>
        <CardDescription className="text-xs">
          How well the optimized resume follows the custom optimization policy
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        <div className="flex items-center justify-center">
          <ScoreRing value={complianceScore} size={100} label="Compliance" />
        </div>

        {/* Summary bar */}
        <div className="text-xs text-center text-muted-foreground">
          {passedCount} / {totalCount} checks passed
        </div>

        {/* Per-check breakdown */}
        {totalCount > 0 && (
          <div className="space-y-1.5">
            {checks.map((check) => (
              <div key={check.check} className="flex items-center gap-2 text-xs">
                <Icon
                  name={check.passed ? "CheckCircle2" : "XCircle"}
                  className={`w-3.5 h-3.5 shrink-0 ${check.passed ? "text-emerald-600" : "text-red-600"}`}
                />
                <span className="font-medium">{check.check}</span>
                {check.detail && (
                  <span className="text-muted-foreground ml-auto text-[10px] truncate max-w-[140px]" title={check.detail}>
                    {check.detail}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {totalCount === 0 && (
          <p className="text-xs text-muted-foreground text-center py-2">No compliance checks available.</p>
        )}
      </CardContent>
    </Card>
  );
}
