"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  ExternalLink,
  GraduationCap,
  KeyRound,
  LayoutDashboard,
  LogOut,
  ShieldCheck,
  Trophy,
  Users,
  Vote,
} from "lucide-react";

import { adminSignOut } from "@/app/admin/login/actions";
import { Button } from "@/components/ui/button";

interface AdminHeaderProps {
  userEmail: string;
}

export function AdminHeader({ userEmail }: AdminHeaderProps) {
  const pathname = usePathname();

  function getPageInfo() {
    if (pathname === "/admin") {
      return { section: "Console", title: "Election Dashboard", icon: LayoutDashboard };
    }
    if (pathname.startsWith("/admin/departments")) {
      return { section: "Management", title: "Departments", icon: Building2 };
    }
    if (pathname === "/admin/faculty") {
      return { section: "Roster", title: "Faculty Roster", icon: Users };
    }
    if (pathname.startsWith("/admin/faculty/codes")) {
      return { section: "Stage 1", title: "Faculty Codes", icon: KeyRound };
    }
    if (pathname.startsWith("/admin/faculty/results")) {
      return { section: "Stage 1", title: "Faculty Results", icon: Vote };
    }
    if (pathname.startsWith("/admin/student/codes")) {
      return { section: "Stage 2", title: "Student Codes", icon: GraduationCap };
    }
    if (pathname.startsWith("/admin/final/results")) {
      return { section: "Publication", title: "Final Results & Publish", icon: Trophy };
    }
    return { section: "Admin", title: "Admin Console", icon: ShieldCheck };
  }

  const page = getPageInfo();
  const Icon = page.icon;

  return (
    <header className="sticky top-0 z-20 hidden md:flex h-16 w-full items-center justify-between border-b border-border/80 bg-background/95 px-6 sm:px-8 backdrop-blur-md print:hidden">
      {/* Breadcrumb / Page Title */}
      <div className="flex items-center gap-2.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/75">
          {page.section}
        </span>
        <span className="text-muted-foreground/30 font-light">/</span>
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-4" />
          </div>
          <span className="text-sm font-bold text-foreground">
            {page.title}
          </span>
        </div>
      </div>

      {/* Right Controls: Quick Links & User Badge */}
      <div className="flex items-center gap-3">
        {/* Quick links to public views */}
        <div className="flex items-center gap-2">
          <Link
            href="/results"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-input bg-background px-2.5 text-xs font-medium text-muted-foreground shadow-2xs hover:bg-muted hover:text-foreground transition-colors"
          >
            <Trophy className="size-3.5 text-primary" />
            <span>Live Results</span>
            <ExternalLink className="size-3 text-muted-foreground/60" />
          </Link>
          <Link
            href="/vote"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-input bg-background px-2.5 text-xs font-medium text-muted-foreground shadow-2xs hover:bg-muted hover:text-foreground transition-colors"
          >
            <Vote className="size-3.5 text-primary" />
            <span>Ballot Entry</span>
            <ExternalLink className="size-3 text-muted-foreground/60" />
          </Link>
        </div>

        {/* User Identity & Sign Out */}
        <div className="flex items-center gap-2.5 pl-3 border-l border-border/80">
          <div className="flex items-center gap-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold text-xs">
              {userEmail[0]?.toUpperCase() || "A"}
            </div>
            <div className="hidden lg:flex flex-col text-left">
              <span className="text-xs font-semibold text-foreground truncate max-w-[150px]">
                {userEmail}
              </span>
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                Admin
              </span>
            </div>
          </div>

          <form action={adminSignOut}>
            <Button
              type="submit"
              variant="ghost"
              size="icon"
              title="Sign Out"
              aria-label="Sign Out"
              className="size-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
            >
              <LogOut className="size-3.5" />
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
