"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Logo, Icon, Badge } from "@/components/shared";
import { useApp } from "@/lib/store";
import { NAV_USER, NAV_ADMIN, NAV_SUPER, BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const user = useApp((s) => s.user);
  const collapsed = useApp((s) => s.sidebarCollapsed);
  const toggle = useApp((s) => s.toggleSidebar);

  const role = user?.role ?? "user";
  const groups: { label: string; items: typeof NAV_USER }[] = [];
  groups.push({ label: "Workspace", items: NAV_USER });
  if (role === "admin" || role === "super_admin") groups.push({ label: "Admin", items: NAV_ADMIN });
  if (role === "super_admin") groups.push({ label: "Super Admin", items: NAV_SUPER });

  return (
    <aside
      className={cn(
        "shrink-0 sticky top-0 h-screen bg-sidebar text-sidebar-foreground flex flex-col transition-all",
        collapsed ? "w-[68px]" : "w-[260px]"
      )}
    >
      {/* Brand */}
      <div className="h-16 px-4 flex items-center justify-between border-b border-sidebar-border">
        <Link href="/" className="flex items-center min-w-0" aria-label={BRAND.name}>
          <Logo size={32} withText={!collapsed} className="[&_span]:text-sidebar-foreground [&_.gradient-text]:text-gold" />
        </Link>
        <button
          onClick={toggle}
          className="hidden lg:flex w-7 h-7 rounded-md hover:bg-sidebar-accent items-center justify-center text-sidebar-foreground/70"
          aria-label="Toggle sidebar"
        >
          <Icon name={collapsed ? "ChevronsRight" : "ChevronsLeft"} className="w-4 h-4" />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-5" aria-label="App navigation">
        {groups.map((g) => (
          <div key={g.label}>
            {!collapsed && (
              <div className="px-2 mb-2 text-[10px] uppercase tracking-wider text-sidebar-foreground/50 font-semibold">
                {g.label}
              </div>
            )}
            <div className="space-y-0.5">
              {g.items.map((item) => {
                const active = view === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => setView(item.key as any)}
                    className={cn(
                      "w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm font-medium transition relative group",
                      active ? "bg-sidebar-accent text-white" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-white",
                      collapsed && "justify-center"
                    )}
                    title={collapsed ? item.label : undefined}
                  >
                    {active && (
                      <motion.div
                        layoutId="sidebar-active"
                        className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full bg-gold"
                      />
                    )}
                    <Icon name={item.icon} className="w-4 h-4 shrink-0" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Upgrade / Free badge */}
      <div className="p-3 border-t border-sidebar-border">
        {!collapsed ? (
          <div className="rounded-xl bg-sidebar-accent/60 p-3 text-center">
            <Badge variant="gold" className="mb-2"><Icon name="Gift" className="w-3 h-3" /> 100% Free</Badge>
            <div className="text-xs text-sidebar-foreground/70 mb-2">No paywalls. No watermarks. Ever.</div>
            <a href={BRAND.social.github} target="_blank" rel="noreferrer noopener" className="text-xs text-gold hover:underline flex items-center justify-center gap-1">
              <Icon name="Heart" className="w-3 h-3" /> Sponsor us
            </a>
          </div>
        ) : (
          <div className="flex justify-center">
            <div className="w-9 h-9 rounded-full gradient-gold flex items-center justify-center" title="100% Free forever">
              <Icon name="Gift" className="w-4 h-4 text-sidebar" />
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
