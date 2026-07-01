"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, Icon } from "@/components/shared";
import type { UndoRedoEntry } from "@/lib/builder-persistence";

interface Props {
  undoStack: UndoRedoEntry[];
  canUndo: boolean;
  canRedo: boolean;
  totalUndos: number;
  totalRedos: number;
  onUndo: () => boolean;
  onRedo: () => boolean;
  onSnapshot: (label?: string) => void;
  onJump: (index: number) => boolean;
  open: boolean;
  onToggle: () => void;
}

/**
 * UndoRedoPanel — shows the full edit history with session grouping,
 * undo/redo buttons, snapshot creation, and jump-to-any-point.
 */
export function UndoRedoPanel({
  undoStack,
  canUndo,
  canRedo,
  totalUndos,
  totalRedos,
  onUndo,
  onRedo,
  onSnapshot,
  onJump,
  open,
  onToggle,
}: Props) {
  const [snapshotLabel, setSnapshotLabel] = useState("");

  // Group entries by session (contiguous entries within same minute)
  const sessions: Array<{ label: string; entries: UndoRedoEntry[]; indices: number[] }> = [];
  let currentSession: typeof sessions[0] | null = null;

  undoStack.forEach((entry, i) => {
    const sessionGroup = entry.sessionId || `sess-${Math.floor(entry.timestamp / 60000)}`;
    if (!currentSession || currentSession.label !== sessionGroup) {
      currentSession = { label: sessionGroup, entries: [], indices: [] };
      sessions.push(currentSession);
    }
    currentSession.entries.push(entry);
    currentSession.indices.push(i);
  });

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    return isToday ? time : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
  };

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={onToggle}
        className="gap-1.5 h-8 relative"
        title="Edit history"
      >
        <Icon name="History" className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">History</span>
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
        <Card className="border-muted">
          <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Icon name="History" className="w-4 h-4" />
                Edit History
                <Badge variant="outline" className="text-[10px]">
                  {undoStack.length} entries
                </Badge>
              </CardTitle>
            </div>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                disabled={!canUndo}
                onClick={onUndo}
                title="Undo (Ctrl+Z)"
              >
                <Icon name="Undo2" className="w-3 h-3 mr-1" /> Undo
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                disabled={!canRedo}
                onClick={onRedo}
                title="Redo (Ctrl+Shift+Z)"
              >
                <Icon name="Redo2" className="w-3 h-3 mr-1" /> Redo
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onToggle}>
                <Icon name="X" className="w-3 h-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            {/* Snapshot creation */}
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                placeholder="Snapshot label (e.g. 'Before major edit')..."
                value={snapshotLabel}
                onChange={(e) => setSnapshotLabel(e.target.value)}
                className="flex-1 h-8 px-2 text-xs rounded border border-input bg-background"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    onSnapshot(snapshotLabel || undefined);
                    setSnapshotLabel("");
                  }
                }}
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1"
                onClick={() => {
                  onSnapshot(snapshotLabel || undefined);
                  setSnapshotLabel("");
                }}
              >
                <Icon name="Camera" className="w-3 h-3" /> Snapshot
              </Button>
            </div>

            {/* History list */}
            {undoStack.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-sm">
                <Icon name="FileEdit" className="w-8 h-8 mx-auto mb-2 opacity-40" />
                No edits yet. Start editing your resume to build history.
              </div>
            ) : (
              <div className="space-y-1 max-h-[300px] overflow-y-auto pr-1">
                {[...undoStack].reverse().map((entry, reverseI) => {
                  const actualIndex = undoStack.length - 1 - reverseI;
                  const isLast = actualIndex === undoStack.length - 1;
                  return (
                    <div
                      key={`${entry.timestamp}-${actualIndex}`}
                      className={`flex items-center gap-2 py-1.5 px-2 rounded text-xs cursor-pointer
                        ${isLast ? "bg-brand/5 border border-brand/20" : "hover:bg-muted/50"}
                        transition-colors`}
                      onClick={() => onJump(actualIndex)}
                      title="Jump to this point in history"
                    >
                      <Icon
                        name={entry.label ? "Bookmark" : "FileEdit"}
                        className="w-3 h-3 flex-shrink-0 text-muted-foreground"
                      />
                      <span className="flex-1 truncate">
                        {entry.label || `Edit #${actualIndex + 1}`}
                      </span>
                      <span className="text-muted-foreground flex-shrink-0 ml-auto">
                        {formatTime(entry.timestamp)}
                      </span>
                      {entry.label && (
                        <Badge variant="default" className="text-[9px] bg-emerald-500">
                          Snapshot
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
          <CardFooter className="pt-2 pb-3 px-4 flex justify-between text-[10px] text-muted-foreground">
            <span>
              Undos: {totalUndos} &middot; Redos: {totalRedos}
            </span>
            <span>
              History persists across page refreshes (IndexedDB)
            </span>
          </CardFooter>
        </Card>
      </motion.div>
    </AnimatePresence>
  );
}
