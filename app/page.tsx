import type { Metadata } from "next";
import Link from "next/link";
import {
  Award,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  GraduationCap,
  HelpCircle,
  Lock,
  QrCode,
  ShieldCheck,
  Sparkles,
  Users,
  Vote,
} from "lucide-react";

import { QuickCodeForm } from "@/components/quick-code-form";

export const metadata: Metadata = {
  title: "Teachers' Day Voting · Honoring Our Faculty",
  description:
    "Official department-isolated, two-stage voting platform honoring distinguished faculty members.",
};

export default function HomePage() {
  return (
    <div className="flex flex-col flex-1">
      {/* Hero Section */}
      <section className="relative overflow-hidden border-b border-border/80 bg-radial-[at_top] from-primary/10 via-background to-background py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex flex-col items-center text-center">
            {/* Pill Badge */}
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3.5 py-1 text-xs font-semibold text-primary shadow-xs">
              <Sparkles className="size-3.5 text-primary" />
              <span>Teachers&apos; Day Honoree Elections</span>
            </div>

            {/* Main Headline */}
            <h1 className="mt-6 max-w-3xl text-3xl font-extrabold tracking-tight text-foreground sm:text-5xl sm:leading-tight">
              Honoring Excellence in Teaching, Decided by{" "}
              <span className="text-primary underline decoration-primary/30 decoration-wavy underline-offset-4">
                Peers &amp; Students
              </span>
            </h1>

            {/* Subtitle */}
            <p className="mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
              A department-isolated, two-stage election celebrating outstanding
              faculty. Faculty peer voting advances the Top-3 finalists, then
              students elect the department honoree.
            </p>

            {/* Quick Code Entry Box */}
            <div className="mt-10 w-full max-w-xl rounded-2xl border border-border/80 bg-card p-6 shadow-sm">
              <div className="mb-4 flex flex-col items-center sm:items-start text-center sm:text-left">
                <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                  Voter Quick Access
                </span>
                <h2 className="text-base font-bold text-foreground">
                  Have your printed voting slip or code?
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Enter your 12-character voting code below to open your
                  department ballot immediately.
                </p>
              </div>

              <div className="flex justify-center">
                <QuickCodeForm />
              </div>

              <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <QrCode className="size-4 text-primary" />
                <span>
                  Slips also feature a QR code you can scan directly with your
                  smartphone camera.
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/vote"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90"
              >
                <Vote className="size-4" />
                <span>Go to Voting Portal</span>
              </Link>
              <Link
                href="/results"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-input bg-background px-5 text-sm font-semibold text-foreground shadow-xs transition hover:bg-muted"
              >
                <BarChart3 className="size-4 text-muted-foreground" />
                <span>View Published Results</span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Two-Stage Process Section */}
      <section className="border-b border-border/80 bg-background py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="text-center">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">
              Democracy in Motion
            </span>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              How the Two-Stage Election Works
            </h2>
            <p className="mt-2 text-sm text-muted-foreground max-w-xl mx-auto">
              Our unique two-stage model ensures fair academic peer review
              paired with genuine student voice across every department.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
            {/* Step 1 */}
            <div className="relative rounded-2xl border border-border/80 bg-card p-6 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary font-bold text-base">
                    1
                  </div>
                  <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    Stage 1
                  </span>
                </div>
                <h3 className="mt-4 text-lg font-bold text-foreground">
                  Faculty Peer Voting
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Every eligible department faculty member receives an individual
                  single-use code to vote for one peer in their own department.
                  Self-voting is strictly forbidden.
                </p>
              </div>
              <div className="mt-6 border-t border-border/60 pt-4 flex items-center gap-2 text-xs font-medium text-foreground">
                <CheckCircle2 className="size-4 text-primary shrink-0" />
                <span>Top-3 candidates advance as Finalists</span>
              </div>
            </div>

            {/* Step 2 */}
            <div className="relative rounded-2xl border border-border/80 bg-card p-6 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary font-bold text-base">
                    2
                  </div>
                  <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    Stage 2
                  </span>
                </div>
                <h3 className="mt-4 text-lg font-bold text-foreground">
                  Student Final Voting
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Students cast votes using department-bound codes. Each code
                  strictly opens the ballot containing that department&apos;s
                  frozen Top-3 Finalists only.
                </p>
              </div>
              <div className="mt-6 border-t border-border/60 pt-4 flex items-center gap-2 text-xs font-medium text-foreground">
                <CheckCircle2 className="size-4 text-primary shrink-0" />
                <span>Department-bound single-use codes</span>
              </div>
            </div>

            {/* Step 3 */}
            <div className="relative rounded-2xl border border-border/80 bg-card p-6 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary font-bold text-base">
                    3
                  </div>
                  <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    Honors
                  </span>
                </div>
                <h3 className="mt-4 text-lg font-bold text-foreground">
                  Published Honorees
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  One Winner is selected and published per participating
                  department. Results are officially celebrated during
                  Teachers&apos; Day ceremonies.
                </p>
              </div>
              <div className="mt-6 border-t border-border/60 pt-4 flex items-center gap-2 text-xs font-medium text-foreground">
                <Award className="size-4 text-primary shrink-0" />
                <span>One Honored Faculty per Department</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust & Architecture Pillars */}
      <section className="border-b border-border/80 bg-muted/20 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="text-center">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">
              Security &amp; Integrity
            </span>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Architectural Guarantees
            </h2>
            <p className="mt-2 text-sm text-muted-foreground max-w-xl mx-auto">
              Built from the ground up to protect voter anonymity and ensure
              uncompromised election integrity.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {/* Pillar 1 */}
            <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-xs">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary mb-3">
                <Lock className="size-5" />
              </div>
              <h3 className="text-base font-semibold text-foreground">
                100% Secret Ballot
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                No passwords, no accounts, no profiles. Token rows never store
                voter choice, and vote tallies carry zero foreign keys to
                tokens.
              </p>
            </div>

            {/* Pillar 2 */}
            <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-xs">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary mb-3">
                <Users className="size-5" />
              </div>
              <h3 className="text-base font-semibold text-foreground">
                Department Isolation
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Colleges and departments (CCS, COED, etc.) vote strictly
                independently. Cross-department ballots or submissions are
                cryptographically blocked.
              </p>
            </div>

            {/* Pillar 3 */}
            <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-xs">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary mb-3">
                <QrCode className="size-5" />
              </div>
              <h3 className="text-base font-semibold text-foreground">
                Mobile-First QR Flow
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Voters can scan their printed QR slip or type their
                12-character code. Completed in under 45 seconds on any
                smartphone.
              </p>
            </div>

            {/* Pillar 4 */}
            <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-xs">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary mb-3">
                <ShieldCheck className="size-5" />
              </div>
              <h3 className="text-base font-semibold text-foreground">
                Tamper-Resistant
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Single-use tokens with server-side SHA-256 peppered hashing,
                atomic database transactions, and comprehensive audit logs.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-16 sm:py-20 bg-background">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <div className="text-center">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">
              Got Questions?
            </span>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Frequently Asked Questions
            </h2>
          </div>

          <div className="mt-10 flex flex-col gap-4">
            <div className="rounded-xl border border-border/80 bg-card p-5">
              <div className="flex items-start gap-3">
                <HelpCircle className="size-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    Where do I get my voting code?
                  </h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    Faculty receive their individual voting slips directly from
                    the election administrator. Students receive their
                    department-bound slips from department distribution desks
                    during active voting windows.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border/80 bg-card p-5">
              <div className="flex items-start gap-3">
                <HelpCircle className="size-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    Can anyone see who I voted for?
                  </h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    No. The system is engineered so no record joins a voter or
                    code to a candidate choice. Once your vote is counted, your
                    token is marked as used and the transient link is discarded.
                    All admin interfaces display aggregates only, never voter-to-choice.
                    The schema carries no join key between votes and tokens, though
                    we do not claim mathematical unlinkability against raw database
                    timing correlation.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border/80 bg-card p-5">
              <div className="flex items-start gap-3">
                <HelpCircle className="size-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    What happens if there is a tie?
                  </h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    If candidates tie at the Top-3 cutoff or for the winner spot,
                    an automated tie alert holds that department while others
                    advance. Ties are resolved strictly under a documented tie
                    policy locked in advance, and every resolution is recorded
                    in the admin audit log.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border/80 bg-card p-5">
              <div className="flex items-start gap-3">
                <HelpCircle className="size-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    Can I vote more than once or change my vote?
                  </h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    No. To ensure integrity, each voting code is single-use and
                    permanently burned once submitted. You will be prompted to
                    confirm your selection before it is recorded.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Bottom CTA Banner */}
      <section className="border-t border-border/80 bg-primary/5 py-12 sm:py-16">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 text-center">
          <GraduationCap className="size-10 text-primary mx-auto mb-3" />
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Ready to Cast Your Ballot?
          </h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
            Take under a minute to honor the educators who make a lasting
            difference in our academic journey.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/vote"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90"
            >
              <span>Cast Your Vote Now</span>
              <ChevronRight className="size-4" />
            </Link>
            <Link
              href="/results"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-input bg-background px-5 text-sm font-semibold text-foreground shadow-xs transition hover:bg-muted"
            >
              <span>Check Honorees</span>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
