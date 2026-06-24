import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/shared";
import { toast } from "sonner";
import { getPuterProvider } from "@/lib/providers/puter-provider";

export function PuterAuthCard({ status, onRefreshStatus }: { status: any, onRefreshStatus: () => void }) {
  const [loading, setLoading] = useState(false);
  const puter = getPuterProvider();
  
  const handleAddAccount = async () => {
    setLoading(true);
    try {
      await puter.login();
      toast.success("Account added successfully.");
      onRefreshStatus();
    } catch (e: any) {
      toast.error(e.message || "Failed to add account");
    } finally {
      setLoading(false);
    }
  };

  const handleSwitch = async (id: string) => {
    setLoading(true);
    try {
      await puter.setActiveAccount(id);
      toast.success("Account switched.");
      onRefreshStatus();
    } catch (e: any) {
      toast.error(e.message || "Failed to switch account");
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (id: string) => {
    setLoading(true);
    try {
      await puter.removeAccount(id);
      toast.success("Account removed.");
      onRefreshStatus();
    } catch (e: any) {
      toast.error(e.message || "Failed to remove account");
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshTokens = async () => {
    setLoading(true);
    try {
      await puter.refresh();
      toast.success("Sessions refreshed.");
      onRefreshStatus();
    } catch (e: any) {
      toast.error(e.message || "Failed to refresh");
    } finally {
      setLoading(false);
    }
  };

  const accounts = status.accounts || [];

  return (
    <Card className="border-amber-500/20 overflow-hidden flex flex-col h-full bg-card shadow-sm hover:shadow-md transition-shadow">
      <CardHeader className="bg-amber-500/5 pb-4 border-b border-amber-500/10">
        <CardTitle className="text-base flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-amber-500/20 text-amber-600 dark:text-amber-500">
              <Icon name="Sparkles" className="w-4 h-4" />
            </div>
            <div>
              <span>Puter.js</span>
              <p className="text-xs font-normal text-muted-foreground mt-0.5">Free browser-auth with Google OAuth</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleRefreshTokens} disabled={loading} title="Refresh">
              <Icon name="RefreshCw" className="w-3.5 h-3.5" />
            </Button>
            <Button size="sm" onClick={handleAddAccount} disabled={loading} className="bg-amber-600 hover:bg-amber-700 text-white gap-1.5">
              {loading ? <Icon name="Loader2" className="w-3.5 h-3.5 animate-spin" /> : <Icon name="Plus" className="w-3.5 h-3.5" />}
              Add Account
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 flex-1 flex flex-col">
        <div className="p-4 space-y-4">
          <div className="text-sm font-medium text-foreground border-b border-border pb-2">Connected Accounts</div>
          
          {accounts.length === 0 ? (
             <div className="text-sm text-muted-foreground text-center py-4">No accounts connected.</div>
          ) : (
            <div className="space-y-3">
              {accounts.map((acc: any) => (
                <div key={acc.id} className={`p-3 rounded-lg border ${acc.active ? 'border-amber-500 bg-amber-50 dark:bg-amber-500/10' : 'border-border bg-secondary/30'} flex flex-col gap-2`}>
                   <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${acc.status === 'healthy' ? 'bg-emerald-500' : acc.status === 'rate_limited' ? 'bg-amber-500' : 'bg-red-500'}`} />
                        <span className="font-medium text-sm">{acc.email}</span>
                        {acc.active && <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-400">Active</span>}
                      </div>
                      <div className="flex gap-1.5">
                        {!acc.active && (
                          <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => handleSwitch(acc.id)} disabled={loading}>Switch</Button>
                        )}
                        <Button size="sm" variant="ghost" className="h-7 text-xs px-2 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => handleRemove(acc.id)} disabled={loading}>Remove</Button>
                      </div>
                   </div>
                   <div className="text-xs text-muted-foreground grid grid-cols-2 gap-1">
                      <div>Models: claude-sonnet-4-5, gpt-4o, gemini-2.5-flash</div>
                      <div>Status: {acc.status === "healthy" ? "Healthy" : acc.status === "rate_limited" ? "Rate Limited" : "Expired"}</div>
                   </div>
                </div>
              ))}
            </div>
          )}
        </div>
        
        {accounts.length > 0 && (
          <div className="mt-auto border-t border-border bg-secondary/20 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Auto-rotate accounts</Label>
                <p className="text-xs text-muted-foreground">Switch to next healthy account when limits reached</p>
              </div>
              <Switch checked={status.autoRotate} onCheckedChange={async (v) => { await puter.setAutoRotate(v); onRefreshStatus(); }} disabled={loading} />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Use selected account globally</Label>
                <p className="text-xs text-muted-foreground">Force this account for all generation tasks</p>
              </div>
              <Switch checked={status.useGlobally} onCheckedChange={async (v) => { await puter.setUseGlobally(v); onRefreshStatus(); }} disabled={loading} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
