import type { Metadata } from "next";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdminSession } from "@/lib/auth/admin-session";
import { applyAdvisoryWindowExpiry, type ElectionStage } from "@/lib/election";
import { listElections } from "@/lib/election/queries";

export const metadata: Metadata = {
  title: "Settings · Admin",
  description: "Read-only system and election configuration settings.",
};

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ election?: string }>;
}) {
  const auth = await requireAdminSession({
    unauthenticatedMessage: "Sign in as an admin to view settings.",
  });

  if (!auth.ok) {
    return (
      <section aria-labelledby="settings-heading" className="flex flex-col gap-4">
        <div>
          <h1 id="settings-heading" className="text-2xl font-semibold tracking-tight">
            Settings
          </h1>
        </div>
        <p role="alert" className="text-sm font-medium text-destructive">
          {auth.message}
        </p>
      </section>
    );
  }

  const resolvedParams = await searchParams;
  const electionsResult = await listElections();
  const elections = electionsResult.ok ? electionsResult.elections : [];

  const first = elections[0];
  const selectedId =
    typeof resolvedParams.election === "string" &&
    elections.some((item) => item.id === resolvedParams.election)
      ? resolvedParams.election
      : first?.id;
  const selected = elections.find((item) => item.id === selectedId) ?? first;

  let electionDetail: {
    id: string;
    name: string;
    academic_year: string;
    stage: string;
    tie_policy_text: string | null;
    tie_policy_locked_at: string | null;
  } | null = null;

  if (selected) {
    const { data } = await auth.session.supabase
      .from("elections")
      .select("id, name, academic_year, stage, tie_policy_text, tie_policy_locked_at")
      .eq("id", selected.id)
      .maybeSingle();
      electionDetail = data;
  }

  const currentStage: ElectionStage =
    electionDetail &&
    ["DRAFT", "FACULTY_VOTING", "FACULTY_RESULTS", "STUDENT_VOTING", "FINAL_RESULTS", "CLOSED"].includes(
      electionDetail.stage,
    )
      ? (electionDetail.stage as ElectionStage)
      : "FACULTY_VOTING";

  const advisoryDemo = applyAdvisoryWindowExpiry({
    stage: currentStage,
    now: "2026-10-04T12:00:00.000Z",
    window: {
      opensAt: "2026-10-04T08:00:00.000Z",
      closesAt: "2026-10-04T11:00:00.000Z",
    },
  });

  return (
    <section aria-labelledby="settings-heading" className="flex flex-col gap-6">
      <div>
        <h1 id="settings-heading" className="text-2xl font-semibold tracking-tight">
          System Settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Read-only configuration parameters, security settings, and election policies.
        </p>
      </div>

      {electionDetail ? (
        <Card>
          <CardHeader>
            <CardTitle>Election Configuration ({electionDetail.name})</CardTitle>
            <p className="text-xs text-muted-foreground">
              Configuration for the selected election lifecycle.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
              <div className="rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground">Academic Year</dt>
                <dd className="mt-1 font-semibold">{electionDetail.academic_year}</dd>
              </div>
              <div className="rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground">Global Stage</dt>
                <dd className="mt-1 font-semibold">{electionDetail.stage}</dd>
              </div>
              <div className="rounded-lg border p-3 sm:col-span-2">
                <dt className="text-xs text-muted-foreground">Tie-Breaking Policy</dt>
                <dd className="mt-1 text-sm font-mono whitespace-pre-wrap bg-muted/40 p-2.5 rounded border border-border/60">
                  {electionDetail.tie_policy_text || "No policy text configured."}
                </dd>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {electionDetail.tie_policy_locked_at
                    ? `Policy locked at ${electionDetail.tie_policy_locked_at}`
                    : "Policy not locked yet (locks automatically upon opening faculty voting)."}
                </p>
              </div>
            </dl>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Advisory Voting Windows</CardTitle>
          <p className="text-xs text-muted-foreground">
            Display-only window timers and expiry invariant (spec §5).
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Optional advisory voting windows (<code className="text-xs font-mono">opens_at</code> / <code className="text-xs font-mono">closes_at</code>) provide timer countdowns and scheduling visibility without mutating stages (<code className="text-xs font-mono">moved: false</code>), preserving manual admin authority per spec §5.
          </p>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
            <div className="rounded-lg border p-3">
              <dt className="text-xs text-muted-foreground">Advisory Invariant</dt>
              <dd className="mt-1 font-semibold">Non-Mutating Expiry</dd>
              <dd className="mt-0.5 text-xs text-muted-foreground">
                <code className="font-mono">applyAdvisoryWindowExpiry</code> guarantees <code className="font-mono">moved: false</code> on all window transitions.
              </dd>
            </div>
            <div className="rounded-lg border p-3">
              <dt className="text-xs text-muted-foreground">Admin Authority</dt>
              <dd className="mt-1 font-semibold">Manual Stage Advance</dd>
              <dd className="mt-0.5 text-xs text-muted-foreground">
                Stage progression requires explicit admin action in the lifecycle controls.
              </dd>
            </div>
            <div className="rounded-lg border p-3 sm:col-span-2">
              <dt className="text-xs text-muted-foreground">State Machine Demonstration</dt>
              <dd className="mt-1 text-xs font-mono bg-muted/40 p-2.5 rounded border border-border/60">
                {advisoryDemo.ok
                  ? `applyAdvisoryWindowExpiry(stage: "${advisoryDemo.value.stage}", windowExpired: ${String(advisoryDemo.value.windowExpired)}) => moved: ${String(advisoryDemo.value.moved)}`
                  : "Evaluation failed"}
              </dd>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Even when windowExpired is true, moved remains strictly false.
              </p>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Architectural Security &amp; Invariants (Locked)</CardTitle>
          <p className="text-xs text-muted-foreground">
            Architectural constraints enforced at the database and application boundary.
          </p>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
            <div className="rounded-lg border p-3">
              <dt className="text-xs text-muted-foreground">Voter Token Entropy</dt>
              <dd className="mt-1 font-semibold">12-character Codes (3 groups of 4)</dd>
              <dd className="mt-0.5 text-xs text-muted-foreground">
                Unambiguous 32-character alphabet (~60 bits entropy)
              </dd>
            </div>
            <div className="rounded-lg border p-3">
              <dt className="text-xs text-muted-foreground">Token Storage</dt>
              <dd className="mt-1 font-semibold">SHA-256(pepper + Code)</dd>
              <dd className="mt-0.5 text-xs text-muted-foreground">
                Raw codes are never persisted and never logged
              </dd>
            </div>
            <div className="rounded-lg border p-3">
              <dt className="text-xs text-muted-foreground">Ballot Privacy Invariant</dt>
              <dd className="mt-1 font-semibold">Zero Join Keys</dd>
              <dd className="mt-0.5 text-xs text-muted-foreground">
                No foreign key joins votes to tokens or voter identities
              </dd>
            </div>
            <div className="rounded-lg border p-3">
              <dt className="text-xs text-muted-foreground">Admin Authorization</dt>
              <dd className="mt-1 font-semibold">Allowlist Gated (public.admins)</dd>
              <dd className="mt-0.5 text-xs text-muted-foreground">
                Deny-by-default Row-Level Security on all voting tables
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </section>
  );
}
