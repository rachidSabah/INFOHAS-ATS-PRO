"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import { NAV_USER, NAV_ADMIN, NAV_SUPER } from "@/lib/brand";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { motion, AnimatePresence } from "framer-motion";

interface SearchResult {
  type: "resume" | "jd" | "cover-letter" | "interview" | "view";
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  action: () => void;
}

export function TopBar() {
  const user = useApp((s) => s.user);
  const signOut = useApp((s) => s.signOut);
  const setView = useApp((s) => s.setView);
  const toggleTheme = useApp((s) => s.toggleTheme);
  const theme = useApp((s) => s.theme);
  const view = useApp((s) => s.view);
  const resumes = useApp((s) => s.resumes);
  const jds = useApp((s) => s.jobDescriptions);
  const coverLetters = useApp((s) => s.coverLetters);
  const interviews = useApp((s) => s.interviews);
  const logs = useApp((s) => s.logs);
  const providers = useApp((s) => s.providers);
  const setActiveResume = useApp((s) => s.setActiveResume);
  const setActiveJD = useApp((s) => s.setActiveJD);
  const setActiveCoverLetter = useApp((s) => s.setActiveCoverLetter);
  const setActiveInterview = useApp((s) => s.setActiveInterview);
  const toggleSidebar = useApp((s) => s.toggleSidebar);
  const sidebarCollapsed = useApp((s) => s.sidebarCollapsed);

  const initials = (user?.name || "U").split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");
  const [q, setQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Cmd/Ctrl+K to focus search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        setSearchOpen(true);
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
        searchInputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Build search results
  const results = useMemo<SearchResult[]>(() => {
    if (!q.trim()) return [];
    const query = q.toLowerCase();
    const out: SearchResult[] = [];

    // Quick views
    const viewMatches: { key: any; label: string; icon: string }[] = [
      { key: "dashboard", label: "Dashboard", icon: "LayoutDashboard" },
      { key: "ats-checker", label: "ATS Checker", icon: "ScanText" },
      { key: "builder", label: "Resume Builder", icon: "FilePlus2" },
      { key: "optimizer", label: "Resume Optimizer", icon: "Wand2" },
      { key: "cover-letter", label: "Cover Letters", icon: "Mail" },
      { key: "interview", label: "Interview Prep", icon: "MessagesSquare" },
      { key: "jd-scraper", label: "Job Scraper", icon: "Search" },
      { key: "ai-tools", label: "AI Tools", icon: "Sparkles" },
      { key: "ai-providers", label: "AI Providers", icon: "Cpu" },
      { key: "downloads", label: "Downloads", icon: "Download" },
      { key: "settings", label: "Settings", icon: "Settings" },
    ];
    for (const v of viewMatches) {
      if (v.label.toLowerCase().includes(query)) {
        out.push({
          type: "view", id: `view-${v.key}`, title: v.label, subtitle: "Go to page",
          icon: v.icon, color: "#1154A3", action: () => { setView(v.key); setSearchOpen(false); setQ(""); },
        });
      }
    }

    // Resumes
    for (const r of resumes) {
      if (`${r.name} ${r.headline ?? ""}`.toLowerCase().includes(query)) {
        out.push({
          type: "resume", id: r.id, title: r.name, subtitle: r.headline ?? "Resume",
          icon: "FileText", color: "#1154A3", action: () => { setActiveResume(r.id); setView("builder"); setSearchOpen(false); setQ(""); },
        });
      }
    }

    // Job descriptions
    for (const j of jds) {
      if (`${j.title} ${j.company ?? ""}`.toLowerCase().includes(query)) {
        out.push({
          type: "jd", id: j.id, title: j.title, subtitle: `${j.company ?? ""} · Job description`,
          icon: "Search", color: "#0EA5E9", action: () => { setActiveJD(j.id); setView("jd-scraper"); setSearchOpen(false); setQ(""); },
        });
      }
    }

    // Cover letters
    for (const c of coverLetters) {
      if (c.title.toLowerCase().includes(query)) {
        out.push({
          type: "cover-letter", id: c.id, title: c.title, subtitle: `${c.template} · Cover letter`,
          icon: "Mail", color: "#8B5CF6", action: () => { setActiveCoverLetter(c.id); setView("cover-letter"); setSearchOpen(false); setQ(""); },
        });
      }
    }

    // Interviews
    for (const i of interviews) {
      if (`${i.role ?? "Interview"} ${i.company ?? ""}`.toLowerCase().includes(query)) {
        out.push({
          type: "interview", id: i.id, title: i.role ?? "Interview prep", subtitle: `${i.company ?? ""} · ${i.questions.length} questions`,
          icon: "MessagesSquare", color: "#EC4899", action: () => { setActiveInterview(i.id); setView("interview"); setSearchOpen(false); setQ(""); },
        });
      }
    }

    return out.slice(0, 12);
  }, [q, resumes, jds, coverLetters, interviews, setView, setActiveResume, setActiveJD, setActiveCoverLetter, setActiveInterview]);

  // Build notifications from recent logs + provider status changes
  const notifications = useMemo(() => {
    const items: { id: string; icon: string; color: string; title: string; subtitle: string; time: string; severity: "info" | "warning" | "error" }[] = [];

    // Recent audit logs (last 5)
    for (const l of logs.slice(0, 5)) {
      items.push({
        id: l.id,
        icon: l.severity === "error" ? "AlertCircle" : l.severity === "warning" ? "AlertTriangle" : "Info",
        color: l.severity === "error" ? "#DC2626" : l.severity === "warning" ? "#F59E0B" : "#1154A3",
        title: l.action,
        subtitle: l.details,
        time: timeAgo(new Date(l.timestamp)),
        severity: l.severity,
      });
    }

    // Provider status alerts
    for (const p of providers) {
      if (p.status === "down" || p.status === "degraded") {
        items.push({
          id: `prov-${p.id}`,
          icon: p.status === "down" ? "XCircle" : "AlertTriangle",
          color: p.status === "down" ? "#DC2626" : "#F59E0B",
          title: `${p.name} is ${p.status}`,
          subtitle: `Check AI Providers → ${p.name}`,
          time: p.lastUsedAt ? timeAgo(new Date(p.lastUsedAt)) : "—",
          severity: p.status === "down" ? "error" : "warning",
        });
      }
    }

    return items.slice(0, 8);
  }, [logs, providers]);

  const unreadCount = notifications.filter((n) => n.severity !== "info").length;

  return (
    <>
      <header className="sticky top-0 z-40 h-16 glass border-b border-border flex items-center gap-3 px-4 sm:px-6">
        {/* Mobile sidebar toggle — actually opens the sidebar */}
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label="Toggle sidebar"
          onClick={() => setMobileSidebarOpen(true)}
        >
          <Icon name="Menu" className="w-5 h-5" />
        </Button>

        {/* Search */}
        <div className="relative flex-1 max-w-md hidden sm:block">
          <Icon name="Search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            ref={searchInputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
            placeholder="Search resumes, jobs, cover letters… (⌘K)"
            className="w-full pl-9 pr-16 h-9 rounded-lg bg-secondary border border-transparent focus:border-border focus:bg-card text-sm transition outline-none"
          />
          <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] px-1.5 py-0.5 rounded border border-border bg-muted text-muted-foreground hidden md:block">
            ⌘K
          </kbd>

          {/* Search results dropdown */}
          <AnimatePresence>
            {searchOpen && q.trim() && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="absolute top-full left-0 right-0 mt-2 bg-card border border-border rounded-lg shadow-premium max-h-96 overflow-y-auto z-50"
              >
                {results.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    <Icon name="SearchX" className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
                    No results for "{q}"
                  </div>
                ) : (
                  <>
                    <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold border-b border-border">
                      {results.length} result{results.length === 1 ? "" : "s"}
                    </div>
                    {results.map((r) => (
                      <button
                        key={`${r.type}-${r.id}`}
                        onClick={r.action}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-secondary text-left transition border-b border-border last:border-0"
                      >
                        <div className="w-8 h-8 rounded-md flex items-center justify-center shrink-0" style={{ background: `${r.color}15`, color: r.color }}>
                          <Icon name={r.icon} className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{r.title}</div>
                          <div className="text-xs text-muted-foreground truncate">{r.subtitle}</div>
                        </div>
                        <Icon name="ArrowRight" className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      </button>
                    ))}
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex-1 sm:hidden" />

        {/* Quick actions */}
        <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme" className="hidden sm:flex">
          <Icon name={theme === "light" ? "Moon" : "Sun"} className="w-4 h-4" />
        </Button>

        {/* Notifications */}
        <DropdownMenu open={notifOpen} onOpenChange={setNotifOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
              <Icon name="Bell" className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80 p-0">
            <div className="px-3 py-2 border-b border-border flex items-center justify-between">
              <span className="text-sm font-semibold">Notifications</span>
              <span className="text-xs text-muted-foreground">{notifications.length} total</span>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  <Icon name="CheckCircle2" className="w-8 h-8 mx-auto text-emerald-500 mb-2" />
                  You're all caught up!
                </div>
              ) : (
                notifications.map((n) => (
                  <DropdownMenuItem key={n.id} className="p-3 cursor-pointer flex items-start gap-2 border-b border-border last:border-0">
                    <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 mt-0.5" style={{ background: `${n.color}15`, color: n.color }}>
                      <Icon name={n.icon} className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{n.title}</div>
                      <div className="text-xs text-muted-foreground truncate">{n.subtitle}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{n.time}</div>
                    </div>
                  </DropdownMenuItem>
                ))
              )}
            </div>
            <div className="p-2 border-t border-border">
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs"
                onClick={() => { setView("logs"); setNotifOpen(false); }}
              >
                View all audit logs
              </Button>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Desktop sidebar collapse toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="hidden lg:flex"
        >
          <Icon name={sidebarCollapsed ? "PanelLeftOpen" : "PanelLeftClose"} className="w-4 h-4" />
        </Button>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-secondary transition" aria-label="Account menu">
              <Avatar className="w-7 h-7">
                <AvatarFallback className="bg-brand text-white text-xs font-semibold">{initials}</AvatarFallback>
              </Avatar>
              <div className="hidden sm:block text-left leading-none">
                <div className="text-xs font-semibold">{user?.name}</div>
                <div className="text-[10px] text-muted-foreground capitalize">{user?.role.replace("_", " ")}</div>
              </div>
              <Icon name="ChevronDown" className="w-3.5 h-3.5 text-muted-foreground hidden sm:block" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="text-sm font-semibold">{user?.name}</div>
              <div className="text-xs text-muted-foreground font-normal">{user?.email}</div>
              <div className="text-[10px] text-muted-foreground mt-1 capitalize">{user?.provider} · {user?.role.replace("_", " ")}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setView("settings")}>
              <Icon name="Settings" className="w-4 h-4 mr-2" /> Account settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setView("downloads")}>
              <Icon name="Download" className="w-4 h-4 mr-2" /> My downloads
            </DropdownMenuItem>
            <DropdownMenuItem onClick={toggleTheme}>
              <Icon name={theme === "light" ? "Moon" : "Sun"} className="w-4 h-4 mr-2" /> {theme === "light" ? "Dark mode" : "Light mode"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setView("settings")} className="gap-2">
              <Icon name="KeyRound" className="w-4 h-4 mr-2" /> Change password
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut} className="text-destructive focus:text-destructive">
              <Icon name="LogOut" className="w-4 h-4 mr-2" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {/* Mobile sidebar drawer */}
      <AnimatePresence>
        {mobileSidebarOpen && (
          <MobileSidebarDrawer onClose={() => setMobileSidebarOpen(false)} />
        )}
      </AnimatePresence>
    </>
  );
}

function MobileSidebarDrawer({ onClose }: { onClose: () => void }) {
  const setView = useApp((s) => s.setView);
  const user = useApp((s) => s.user);
  const toggleTheme = useApp((s) => s.toggleTheme);
  const theme = useApp((s) => s.theme);
  const signOut = useApp((s) => s.signOut);

  const role = user?.role ?? "user";
  const groups: { label: string; items: any[] }[] = [{ label: "Workspace", items: NAV_USER }];
  if (role === "admin" || role === "super_admin") groups.push({ label: "Admin", items: NAV_ADMIN });
  if (role === "super_admin") groups.push({ label: "Super Admin", items: NAV_SUPER });

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm lg:hidden"
      onClick={onClose}
    >
      <motion.div
        initial={{ x: -260 }}
        animate={{ x: 0 }}
        exit={{ x: -260 }}
        transition={{ type: "spring", damping: 28, stiffness: 280 }}
        className="bg-sidebar text-sidebar-foreground w-[260px] h-full flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-16 px-4 flex items-center justify-between border-b border-sidebar-border">
          <div className="font-display font-bold text-lg">ResumeAI <span className="text-gold">Pro</span></div>
          <Button variant="ghost" size="icon" onClick={onClose} className="text-sidebar-foreground hover:bg-sidebar-accent">
            <Icon name="X" className="w-5 h-5" />
          </Button>
        </div>
        <nav className="flex-1 overflow-y-auto p-3 space-y-5">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="px-2 mb-2 text-[10px] uppercase tracking-wider text-sidebar-foreground/50 font-semibold">{g.label}</div>
              <div className="space-y-0.5">
                {g.items.map((item: any) => (
                  <button
                    key={item.key}
                    onClick={() => { setView(item.key); onClose(); }}
                    className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-white transition"
                  >
                    <Icon name={item.icon} className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="p-3 border-t border-sidebar-border space-y-1">
          <button onClick={toggleTheme} className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent">
            <Icon name={theme === "light" ? "Moon" : "Sun"} className="w-4 h-4" /> {theme === "light" ? "Dark mode" : "Light mode"}
          </button>
          <button onClick={signOut} className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm text-red-300 hover:bg-sidebar-accent">
            <Icon name="LogOut" className="w-4 h-4" /> Sign out
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function timeAgo(d: Date): string {
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return d.toLocaleDateString();
}
