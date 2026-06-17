"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import { toast } from "sonner";
import { useState } from "react";

export function UserApprovals() {
  const users = useApp((s) => s.users);
  const approveUser = useApp((s) => s.approveUser);
  const deleteUser = useApp((s) => s.deleteUser);
  const [q, setQ] = useState("");

  const pending = users.filter((u) => u.status === "pending");
  const filtered = pending.filter((u) => `${u.name} ${u.email} ${u.username ?? ""}`.toLowerCase().includes(q.toLowerCase()));

  const handleApprove = (id: string, name: string) => {
    approveUser(id);
    toast.success(`${name} has been approved. They can now access all features.`);
  };

  const handleReject = (id: string, name: string) => {
    if (confirm(`Reject and delete ${name}'s account?`)) {
      deleteUser(id);
      toast.success(`${name}'s account has been deleted.`);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2">
          <Icon name="UserCheck" className="w-6 h-6 text-brand" /> User Approvals
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Review and approve new user registrations. Pending users cannot access any features until approved.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <Card><CardContent className="p-4"><div className="text-2xl font-bold font-display text-amber-600">{pending.length}</div><div className="text-xs text-muted-foreground">Pending</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-2xl font-bold font-display text-emerald-600">{users.filter((u) => u.status === "approved").length}</div><div className="text-xs text-muted-foreground">Approved</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-2xl font-bold font-display text-red-600">{users.filter((u) => u.status === "suspended").length}</div><div className="text-xs text-muted-foreground">Suspended</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-lg">Pending Approvals ({filtered.length})</CardTitle>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="h-9 px-3 rounded-md border border-input bg-background text-sm w-full sm:w-64" />
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <div className="text-center py-12">
              <Icon name="CheckCircle2" className="w-10 h-10 text-emerald-500 mx-auto" />
              <p className="text-sm text-muted-foreground mt-2">No pending approvals. You're all caught up!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((u) => (
                <div key={u.id} className="flex items-center justify-between gap-3 p-4 rounded-lg border border-border">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm flex items-center gap-2">
                      {u.name}
                      <Badge variant="warning" className="text-[9px]">PENDING</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {u.provider} · registered {new Date(u.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <Button size="sm" onClick={() => handleApprove(u.id, u.name)} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5">
                      <Icon name="Check" className="w-3.5 h-3.5" /> Approve
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleReject(u.id, u.name)} className="text-destructive gap-1.5">
                      <Icon name="X" className="w-3.5 h-3.5" /> Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
