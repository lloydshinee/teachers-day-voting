"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Award,
  BarChart3,
  GraduationCap,
  Menu,
  Vote,
  X,
} from "lucide-react";

export function Header() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navLinks = [
    { href: "/", label: "Home" },
    { href: "/vote", label: "Cast Vote", icon: Vote },
    { href: "/results", label: "Published Results", icon: BarChart3 },
  ];

  const isActive = (href: string) => {
    if (href === "/") {
      return pathname === "/";
    }
    return pathname.startsWith(href);
  };

  if (pathname.startsWith("/admin") || pathname.startsWith("/vote")) {
    return null;
  }

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/80 bg-background/85 backdrop-blur-md transition-all print:hidden">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        {/* Brand identity */}
        <Link
          href="/"
          className="group flex items-center gap-2.5 transition-opacity hover:opacity-90"
        >
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs transition-transform group-hover:scale-105">
            <Award className="size-5" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="font-bold tracking-tight text-foreground text-base sm:text-lg">
                Teachers&apos; Day
              </span>
              <span className="hidden rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary sm:inline-block">
                Annual Vote
              </span>
            </div>
            <span className="text-[11px] text-muted-foreground leading-none">
              Faculty Recognition Elections
            </span>
          </div>
        </Link>

        {/* Desktop Navigation */}
        <nav
          aria-label="Main Navigation"
          className="hidden md:flex items-center gap-1"
        >
          {navLinks.map((link) => {
            const active = isActive(link.href);
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {Icon ? <Icon className="size-4" /> : null}
                {link.label}
              </Link>
            );
          })}
        </nav>

        {/* Desktop Right CTA */}
        <div className="hidden md:flex items-center gap-2.5">
          <Link
            href="/vote"
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-3.5 text-xs font-semibold text-primary-foreground shadow-xs transition hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Vote className="size-3.5" />
            Vote with Code
          </Link>
        </div>

        {/* Mobile menu button */}
        <div className="flex md:hidden items-center gap-2">
          <Link
            href="/vote"
            className="inline-flex h-8 items-center justify-center rounded-lg bg-primary px-2.5 text-xs font-semibold text-primary-foreground"
          >
            Vote
          </Link>
          <button
            type="button"
            onClick={() => setMobileMenuOpen((open) => !open)}
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            className="inline-flex size-9 items-center justify-center rounded-lg border border-input bg-background text-foreground hover:bg-muted"
          >
            {mobileMenuOpen ? (
              <X className="size-5" />
            ) : (
              <Menu className="size-5" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile dropdown menu */}
      {mobileMenuOpen && (
        <div className="border-b border-border bg-background px-4 py-4 md:hidden animate-in slide-in-from-top-2 duration-200">
          <nav aria-label="Mobile Navigation" className="flex flex-col gap-1.5">
            {navLinks.map((link) => {
              const active = isActive(link.href);
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-muted"
                  }`}
                >
                  {Icon ? <Icon className="size-4" /> : null}
                  {link.label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-4 border-t border-border pt-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <GraduationCap className="size-4 text-primary" />
              <span>Department-isolated anonymous balloting</span>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
