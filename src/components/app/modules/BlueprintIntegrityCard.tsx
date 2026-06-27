"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, Icon } from "@/components/shared";

/**
 * BlueprintIntegrityCard — displays whether the original resume template/blueprint
 * was preserved during optimization.
 *
 * Shows:
 *   - Whether template/blueprint was preserved
 *   - Fingerprint validity
 *   - Assembler stats (matchedBy* breakdown)
 */

export interface AssemblerStats {
  matchedById: number;
  matchedByFingerprint: number;
  matchedByTitleCompany: number;
  matchedByIndex: number;
  unmatched: number;
}

export interface BlueprintIntegrityCardProps {
  /** Whether the original template structure was preserved */
  templatePreserved: boolean;
  /** Whether experience fingerprints are valid (no fabrication) */
  fingerprintValid: boolean;
  /** Assembler matching statistics */
  assemblerStats: AssemblerStats;
}

export function BlueprintIntegrityCard({ templatePreserved, fingerprintValid, assemblerStats }: BlueprintIntegrityCardProps) {
  const totalMatched =
    assemblerStats.matchedById +
    assemblerStats.matchedByFingerprint +
    assemblerStats.matchedByTitleCompany +
    assemblerStats.matchedByIndex;

  const totalEntries = totalMatched + assemblerStats.unmatched;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Icon name="FileStack" className="w-4 h-4 text-brand" />
          Blueprint Integrity
          <Badge variant={templatePreserved && fingerprintValid ? "success" : "warning"} className="ml-auto text-[10px]">
            {templatePreserved && fingerprintValid ? "INTACT" : "ISSUES DETECTED"}
          </Badge>
        </CardTitle>
        <CardDescription className="text-xs">
          Whether the original resume structure and experience were preserved
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        {/* Template & Fingerprint status */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-secondary/40 p-2.5">
            <div className="flex items-center gap-1.5">
              <Icon
                name={templatePreserved ? "CheckCircle2" : "AlertTriangle"}
                className={`w-3.5 h-3.5 shrink-0 ${templatePreserved ? "text-emerald-600" : "text-amber-600"}`}
              />
              <span className="text-xs font-medium">Template</span>
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {templatePreserved ? "Structure preserved" : "Structure modified"}
            </div>
          </div>
          <div className="rounded-lg bg-secondary/40 p-2.5">
            <div className="flex items-center gap-1.5">
              <Icon
                name={fingerprintValid ? "Fingerprint" : "AlertCircle"}
                className={`w-3.5 h-3.5 shrink-0 ${fingerprintValid ? "text-emerald-600" : "text-red-600"}`}
              />
              <span className="text-xs font-medium">Fingerprint</span>
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {fingerprintValid ? "Valid — no fabrication" : "Invalid — possible fabrication"}
            </div>
          </div>
        </div>

        {/* Assembler stats */}
        <div>
          <div className="text-xs font-semibold mb-2 flex items-center justify-between">
            <span>Assembler Matches</span>
            <span className="text-muted-foreground text-[10px]">{totalMatched}/{totalEntries} entries matched</span>
          </div>
          <div className="space-y-1.5">
            <AssemblerStatRow
              icon="Hash"
              label="Matched by ID"
              value={assemblerStats.matchedById}
              total={totalEntries}
              color="text-emerald-600"
            />
            <AssemblerStatRow
              icon="Fingerprint"
              label="Matched by Fingerprint"
              value={assemblerStats.matchedByFingerprint}
              total={totalEntries}
              color="text-blue-600"
            />
            <AssemblerStatRow
              icon="Building2"
              label="Matched by Title + Company"
              value={assemblerStats.matchedByTitleCompany}
              total={totalEntries}
              color="text-brand"
            />
            <AssemblerStatRow
              icon="ListOrdered"
              label="Matched by Index"
              value={assemblerStats.matchedByIndex}
              total={totalEntries}
              color="text-purple-600"
            />
            <AssemblerStatRow
              icon="AlertCircle"
              label="Unmatched (new entries)"
              value={assemblerStats.unmatched}
              total={totalEntries}
              color="text-amber-600"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AssemblerStatRow({
  icon,
  label,
  value,
  total,
  color,
}: {
  icon: string;
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <Icon name={icon} className={`w-3.5 h-3.5 shrink-0 ${color}`} />
      <span className="flex-1">{label}</span>
      <span className="font-semibold">{value}</span>
      {total > 0 && (
        <div className="w-16 h-1.5 rounded-full bg-secondary/60 overflow-hidden">
          <div
            className={`h-full rounded-full ${color.replace("text-", "bg-")}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
