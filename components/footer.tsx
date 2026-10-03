"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Award, Lock, ShieldCheck } from "lucide-react";

export function Footer() {
  const pathname = usePathname();

  if (pathname.startsWith("/admin") || pathname.startsWith("/vote")) {
    return null;
  }

  return (
    <footer className="border-t border-border/80 bg-muted/30 text-muted-foreground print:hidden mt-auto">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
          {/* Brand info */}
          <div className="md:col-span-2 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Award className="size-4" />
              </div>
              <span className="font-semibold text-foreground text-base tracking-tight">
                Teachers&apos; Day Honoree Election
              </span>
            </div>
            <p className="text-sm leading-relaxed max-w-md">
              A department-isolated, two-stage democratic vote to select and
              celebrate distinguished educators. Faculty peer nominations advance
              the Top-3 finalists, followed by student voting to decide department
              winners.
            </p>
            <div className="flex items-center gap-2 text-xs text-foreground/80 mt-1">
              <Lock className="size-3.5 text-primary" />
              <span>Cryptographic single-use codes · Secret ballot architecture</span>
            </div>
          </div>

          {/* Quick links */}
          <div className="flex flex-col gap-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              Voter Access
            </h3>
            <ul className="flex flex-col gap-2 text-sm list-none p-0">
              <li>
                <Link
                  href="/vote"
                  className="hover:text-foreground transition-colors"
                >
                  Cast Your Vote
                </Link>
              </li>
              <li>
                <Link
                  href="/results"
                  className="hover:text-foreground transition-colors"
                >
                  Published Results
                </Link>
              </li>
              <li>
                <Link
                  href="/"
                  className="hover:text-foreground transition-colors"
                >
                  Election Guidelines
                </Link>
              </li>
            </ul>
          </div>

          {/* Election Guarantees */}
          <div className="flex flex-col gap-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              Integrity &amp; Rules
            </h3>
            <ul className="flex flex-col gap-2 text-sm list-none p-0">
              <li className="text-muted-foreground">
                100% Anonymous Ballot
              </li>
              <li className="text-muted-foreground">
                Department Isolation
              </li>
              <li className="text-muted-foreground">
                Single-Use Codes Only
              </li>
              <li className="text-muted-foreground">
                Locked Tie Resolution
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-8 border-t border-border/60 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <p>© {new Date().getFullYear()} Teachers&apos; Day Committee. All rights reserved.</p>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <ShieldCheck className="size-4 text-primary" />
            <span>End-to-End Privacy Guaranteed</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
