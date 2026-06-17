"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

export function TopBar() {
  const user = useApp((s) => s.user);
  const signOut = useApp((s) => s.signOut);
  const setView = useApp((s) => s.setView);
  const toggleTheme = useApp((s) => s.toggleTheme);
  const theme = useApp((s) => s.theme);
  const view = useApp((s) => s.view);

  const initials = (user?.name || "U").split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");
  const [q, setQ] = useState("");

  return (
    <header className="sticky top-0 z-40 h-16 glass border-b border-border flex items-center gap-3 px-4 sm:px-6">
      {/* Mobile menu */}
      <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open sidebar">
        <Icon name="Menu" className="w-5 h-5" />
      </Button>

      {/* Search */}
      <div className="relative flex-1 max-w-md hidden sm:block">
        <Icon name="Search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search resumes, jobs, cover letters..."
          className="w-full pl-9 pr-3 h-9 rounded-lg bg-secondary border border-transparent focus:border-border focus:bg-card text-sm transition outline-none"
        />
        <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] px-1.5 py-0.5 rounded border border-border bg-muted text-muted-foreground hidden md:block">
          ⌘K
        </kbd>
      </div>

      <div className="flex-1 sm:hidden" />

      {/* Quick actions */}
      <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme" className="hidden sm:flex">
        <Icon name={theme === "light" ? "Moon" : "Sun"} className="w-4 h-4" />
      </Button>

      <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
        <Icon name="Bell" className="w-4 h-4" />
        <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-gold" />
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
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setView("settings")}>
            <Icon name="Settings" className="w-4 h-4 mr-2" /> Settings
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setView("downloads")}>
            <Icon name="Download" className="w-4 h-4 mr-2" /> Downloads
          </DropdownMenuItem>
          <DropdownMenuItem onClick={toggleTheme}>
            <Icon name={theme === "light" ? "Moon" : "Sun"} className="w-4 h-4 mr-2" /> {theme === "light" ? "Dark mode" : "Light mode"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={signOut} className="text-destructive focus:text-destructive">
            <Icon name="LogOut" className="w-4 h-4 mr-2" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
