"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  CheckSquare,
  ExternalLink,
  GraduationCap,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  ScrollText,
  Settings,
  ShieldCheck,
  Trophy,
  Users,
  Vote,
  X,
} from "lucide-react";

import { adminSignOut } from "@/app/admin/login/actions";
import { Button } from "@/components/ui/button";

interface AdminSidebarProps {
  userEmail: string;
}

const NAV_ITEMS = [
  {
    href: "/admin",
    label: "Dashboard",
    icon: LayoutDashboard,
    exact: true,
  },
  {
    href: "/admin/departments",
    label: "Departments",
    icon: Building2,
  },
  {
    href: "/admin/faculty",
    label: "Faculty Roster",
    icon: Users,
    exact: true,
  },
  {
    href: "/admin/faculty/codes",
    label: "Faculty Codes",
    icon: KeyRound,
  },
  {
    href: "/admin/faculty/results",
    label: "Faculty Results (Stage 1)",
    icon: Vote,
  },
  {
    href: "/admin/student/codes",
    label: "Student Codes",
    icon: GraduationCap,
  },
  {
    href: "/admin/student/voting",
    label: "Student Voting",
    icon: CheckSquare,
  },
  {
    href: "/admin/final/results",
    label: "Final Results & Publish",
    icon: Trophy,
  },
  {
    href: "/admin/settings",
    label: "Settings",
    icon: Settings,
  },
  {
    href: "/admin/audit-logs",
    label: "Audit Logs",
    icon: ScrollText,
  },
];

export function AdminSidebar({ userEmail }: AdminSidebarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  function isActive(href: string, exact?: boolean) {
    if (exact) {
      return pathname === href;
    }
    return pathname.startsWith(href);
  }

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between p-4 overflow-y-auto">
      {/* Brand & Navigation */}
      <div className="flex flex-col gap-6">
        {/* Brand header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <span className="block text-xs font-bold uppercase tracking-wider text-primary">
                Teachers&apos; Day
              </span>
              <span className="block text-sm font-extrabold text-foreground">
                Admin Console
              </span>
            </div>
          </div>
          {/* Close button on mobile */}
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted md:hidden"
            aria-label="Close menu"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Section title */}
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-2">
            Navigation
          </span>
          <nav className="mt-1 flex flex-col gap-1">
            {NAV_ITEMS.map((item) => {
              const active = isActive(item.href, item.exact);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-semibold transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Icon className="size-4 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Public Views */}
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-2">
            Public Views
          </span>
          <nav className="mt-1 flex flex-col gap-1">
            <Link
              href="/results"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between rounded-xl px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <span className="flex items-center gap-2.5">
                <Trophy className="size-3.5 text-muted-foreground" />
                <span>Live Results Page</span>
              </span>
              <ExternalLink className="size-3 text-muted-foreground/60" />
            </Link>
            <Link
              href="/vote"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between rounded-xl px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <span className="flex items-center gap-2.5">
                <Vote className="size-3.5 text-muted-foreground" />
                <span>Voter Ballot Entry</span>
              </span>
              <ExternalLink className="size-3 text-muted-foreground/60" />
            </Link>
          </nav>
        </div>
      </div>

      {/* Admin User Card & Sign Out */}
      <div className="border-t border-border/70 pt-4 flex flex-col gap-3">
        <div className="flex items-center gap-3 rounded-xl bg-muted/40 p-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold text-xs">
            {userEmail[0]?.toUpperCase() || "A"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="truncate text-xs font-semibold text-foreground">
              {userEmail}
            </p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              <span className="text-[10px] font-medium text-muted-foreground">
                Authorized Admin
              </span>
            </div>
          </div>
        </div>

        <form action={adminSignOut}>
          <Button
            type="submit"
            variant="outline"
            className="w-full justify-center gap-2 text-xs font-semibold text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/20 h-9"
          >
            <LogOut className="size-3.5" />
            <span>Sign Out</span>
          </Button>
        </form>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile top trigger bar */}
      <div className="sticky top-0 z-30 flex h-14 w-full items-center justify-between border-b border-border/80 bg-background/95 px-4 backdrop-blur-md md:hidden print:hidden">
        <div className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-2xs">
            <ShieldCheck className="size-4" />
          </div>
          <span className="text-xs font-extrabold text-foreground">
            Admin Console
          </span>
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="flex items-center gap-1.5 rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs font-medium shadow-2xs hover:bg-muted"
          aria-label="Open navigation sidebar"
        >
          <Menu className="size-4" />
          <span>Menu</span>
        </button>
      </div>

      {/* Mobile drawer backdrop */}
      {mobileOpen ? (
        <div
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-xs md:hidden"
        />
      ) : null}

      {/* Mobile drawer slide-out */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 border-r border-border bg-card shadow-xl transition-transform duration-200 ease-in-out md:hidden ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {sidebarContent}
      </aside>

      {/* Desktop static sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-border/80 bg-card/60 backdrop-blur-sm md:block">
        <div className="sticky top-0 h-screen">{sidebarContent}</div>
      </aside>
    </>
  );
}
