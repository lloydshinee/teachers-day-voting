import type { Metadata } from "next";
import Link from "next/link";

import { DepartmentAvatar } from "@/components/department-avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDepartmentDrilldown } from "@/lib/dashboard/queries";
import { listElections } from "@/lib/election/queries";

import {
  DrilldownPublishControl,
  DrilldownResolveStage1TieForm,
  DrilldownResolveStage2TieForm,
} from "./controls";

export const metadata: Metadata = {
  title: "Department Drill-Down · Admin",
  description:
    "Admin per-department drill-down: faculty count, Code status, vote aggregates, and Top-3 / Finalists with Tie banners.",
};

/**
 * Admin department drill-down (spec §14 task 14, structure §9).
 *
 * Aggregates only (spec §7): faculty count, faculty Codes, faculty votes,
 * student Codes, student votes, and the Top-3 / Finalists with Tie banners —
 * all from the dashboard query composition over the existing aggregate-only
 * modules. No voter-level rows reach this view. Tie resolution and Winner
 * publishing live on the Faculty Results / Final Results pages; this view
 * links to them with the Election context preserved.
 */
export default async function AdminDepartmentDrilldownPage({
  params,
  searchParams,
}: {
  params: Promise<{ departmentId: string }>;
  searchParams: Promise<{ election?: string }>;
}) {
  const resolvedParams = await params;
  const resolvedSearch = await searchParams;
  const electionsResult = await listElections();

  if (!electionsResult.ok) {
    const isDenied =
      electionsResult.code === "UNAUTHENTICATED" ||
      electionsResult.code === "FORBIDDEN";
    return (
      <section aria-labelledby="drilldown-heading" className="flex flex-col gap-4">
        <div>
          <h1
            id="drilldown-heading"
            className="text-2xl font-semibold tracking-tight"
          >
            Department Drill-Down
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Per-department aggregates: Codes, votes, and Top-3 / Finalists.
          </p>
        </div>
        <p role="alert" className="text-sm font-medium text-destructive">
          {isDenied ? electionsResult.message : "Could not load Elections. Try again."}
        </p>
      </section>
    );
  }

  const { elections } = electionsResult;
  if (elections.length === 0) {
    return (
      <section aria-labelledby="drilldown-heading" className="flex flex-col gap-4">
        <div>
          <h1
            id="drilldown-heading"
            className="text-2xl font-semibold tracking-tight"
          >
            Department Drill-Down
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            No Elections yet. Create an Election first.
          </p>
        </div>
      </section>
    );
  }

  const first = elections[0];
  if (!first) {
    return (
      <section aria-labelledby="drilldown-heading" className="flex flex-col gap-4">
        <p role="alert" className="text-sm font-medium text-destructive">
          Could not load Elections. Try again.
        </p>
      </section>
    );
  }
  const selectedId =
    typeof resolvedSearch.election === "string" &&
    elections.some((election) => election.id === resolvedSearch.election)
      ? resolvedSearch.election
      : first.id;

  const drilldown = await getDepartmentDrilldown(
    selectedId,
    resolvedParams.departmentId,
  );
  if (!drilldown.ok) {
    const isDenied =
      drilldown.code === "UNAUTHENTICATED" ||
      drilldown.code === "FORBIDDEN";
    return (
      <section aria-labelledby="drilldown-heading" className="flex flex-col gap-4">
        <div>
          <h1
            id="drilldown-heading"
            className="text-2xl font-semibold tracking-tight"
          >
            Department Drill-Down
          </h1>
        </div>
        <p role="alert" className="text-sm font-medium text-destructive">
          {isDenied
            ? drilldown.message
            : "Could not load this department. It may have been deleted already."}
        </p>
        <Link
          href={`/admin${`?election=${encodeURIComponent(selectedId)}`}`}
          className="inline-flex h-11 items-center justify-center rounded-lg bg-secondary px-4 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 sm:self-start"
        >
          Back to dashboard
        </Link>
      </section>
    );
  }

  const { election, policyVersion, row } = drilldown.drilldown;
  const electionQuery = `?election=${encodeURIComponent(election.id)}`;
  const stage1Tie = row.stage1.cutoff.kind === "tie" ? row.stage1.cutoff : null;
  const stage2Tie =
    row.stage2.winnerResult.kind === "tie" ? row.stage2.winnerResult : null;
  const stage1Top3Ids =
    row.stage1.cutoff.kind === "clean"
      ? new Set(row.stage1.cutoff.top3.map((entry) => entry.candidateId))
      : new Set<string>();
  const stage2TopId =
    row.stage2.winnerResult.kind === "clean"
      ? (row.stage2.winnerResult.winner?.finalistId ?? null)
      : null;

  const isFinalStage =
    election.stage === "FINAL_RESULTS" || election.stage === "CLOSED";
  const canPublish =
    row.participating &&
    row.finalistsLockedAt !== null &&
    policyVersion !== null &&
    !row.tiePending &&
    isFinalStage &&
    !row.stage2.published?.published;
  const publishDisabledReason = row.stage2.published?.published
    ? "Winner already published for this department."
    : row.tiePending
      ? "Resolve pending winner tie before publishing."
      : !isFinalStage
        ? "Publishing is available after student voting closes (stage FINAL_RESULTS)."
        : undefined;

  return (
    <section aria-labelledby="drilldown-heading" className="flex flex-col gap-4">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link
            href={`/admin${electionQuery}`}
            className="font-medium underline underline-offset-4"
          >
            Election Dashboard
          </Link>
          {" · "}
          {election.name} · {election.academicYear} · Stage: {election.stage}
        </p>
        <div className="mt-2 flex items-center gap-3.5">
          <DepartmentAvatar
            name={row.department.name}
            code={row.department.code}
            url={row.department.picture_url}
            size="lg"
          />
          <div>
            <h1 id="drilldown-heading" className="text-2xl font-semibold tracking-tight">
              {row.department.code} · {row.department.name}
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Aggregates only — counts and Tie flags, never voter-to-choice. Tie
              policy:{" "}
              {policyVersion === null
                ? "not frozen yet"
                : `frozen at ${policyVersion}`}
            </p>
          </div>
        </div>
      </div>

      {!row.participating ? (
        <Card>
          <CardHeader>
            <CardTitle>Not participating</CardTitle>
            <p className="text-sm text-muted-foreground">
              This department is not attached to this Election — no counting
              here.
            </p>
          </CardHeader>
        </Card>
      ) : (
        <>
          {row.tiePending && (stage1Tie ?? stage2Tie) ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive bg-destructive/10 p-3"
            >
              {stage1Tie ? (
                <div>
                  <p className="text-sm font-semibold text-destructive">
                    Tie detected for 3rd place
                  </p>
                  <p className="mt-1 text-sm text-destructive">
                    {stage1Tie.tied.length} Candidates share{" "}
                    {stage1Tie.cutoffVotes} votes with{" "}
                    {stage1Tie.seatsRemaining} seat
                    {stage1Tie.seatsRemaining === 1 ? "" : "s"} left. Resolve
                    below or on the Faculty Results page — Ties never auto-resolve.
                  </p>
                  <DrilldownResolveStage1TieForm
                    electionId={election.id}
                    departmentId={row.department.id}
                    tied={stage1Tie.tied}
                    seatsRemaining={stage1Tie.seatsRemaining}
                    cutoffVotes={stage1Tie.cutoffVotes}
                  />
                </div>
              ) : null}
              {stage2Tie ? (
                <div className={stage1Tie ? "mt-4 pt-4 border-t border-destructive/20" : ""}>
                  <p className="text-sm font-semibold text-destructive">
                    Tie detected for winner
                  </p>
                  <p className="mt-1 text-sm text-destructive">
                    {stage2Tie.tied.length} Finalists share {stage2Tie.topVotes}{" "}
                    votes. Resolve below or on the Final Results page — Ties never
                    auto-resolve.
                  </p>
                  <DrilldownResolveStage2TieForm
                    electionId={election.id}
                    departmentId={row.department.id}
                    tied={stage2Tie.tied}
                    topVotes={stage2Tie.topVotes}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Participation</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <div className="rounded-lg border p-3">
                  <dt className="text-muted-foreground">Faculty</dt>
                  <dd className="mt-1 text-xl font-semibold tabular-nums">
                    {row.facultyCodes.eligibleCount}
                  </dd>
                </div>
                <div className="rounded-lg border p-3">
                  <dt className="text-muted-foreground">Faculty Codes</dt>
                  <dd className="mt-1 text-xl font-semibold tabular-nums">
                    {row.facultyCodes.liveUnused + row.facultyCodes.used} /{" "}
                    {row.facultyCodes.eligibleCount}
                  </dd>
                  <dd className="text-xs text-muted-foreground">
                    {row.facultyCodes.liveUnused} live unused ·{" "}
                    {row.facultyCodes.used} used ·{" "}
                    {row.facultyCodes.missingCount} missing
                  </dd>
                </div>
                <div className="rounded-lg border p-3">
                  <dt className="text-muted-foreground">Faculty votes</dt>
                  <dd className="mt-1 text-xl font-semibold tabular-nums">
                    {row.stage1.totalVotes} / {row.facultyCodes.eligibleCount}
                  </dd>
                  <dd className="text-xs text-muted-foreground">
                    cast versus eligible
                  </dd>
                </div>
                <div className="rounded-lg border p-3">
                  <dt className="text-muted-foreground">Student Codes</dt>
                  <dd className="mt-1 text-xl font-semibold tabular-nums">
                    {row.studentCodes.generated}
                  </dd>
                  <dd className="text-xs text-muted-foreground">
                    {row.studentCodes.used} used ·{" "}
                    {row.studentCodes.remaining} remaining
                    {row.studentCodes.invalidated > 0
                      ? ` · ${row.studentCodes.invalidated} invalidated`
                      : ""}
                  </dd>
                </div>
                <div className="rounded-lg border p-3">
                  <dt className="text-muted-foreground">Student votes</dt>
                  <dd className="mt-1 text-xl font-semibold tabular-nums">
                    {row.stage2.totalVotes} / {row.studentCodes.generated}
                  </dd>
                  <dd className="text-xs text-muted-foreground">
                    cast versus generated
                  </dd>
                </div>
                <div className="rounded-lg border p-3">
                  <dt className="text-muted-foreground">Gates</dt>
                  <dd className="mt-1 text-sm font-semibold">
                    {row.finalistsLockedAt !== null
                      ? "Finalists frozen"
                      : "Finalists not frozen"}
                  </dd>
                  <dd className="text-xs text-muted-foreground">
                    {row.winnerPublished
                      ? "Winner published"
                      : "Winner not published"}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                {row.finalistsLockedAt !== null
                  ? `Finalists (${row.stage1.finalists.length})`
                  : "Top-3"}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {row.finalistsLockedAt !== null
                  ? "Frozen snapshot — the Finalists student voting elects from."
                  : "Live Stage-1 standing — freezes as the Finalist snapshot."}
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {row.finalistsLockedAt !== null ? (
                row.stage1.finalists.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Frozen with no Finalists (no Candidates at close time).
                  </p>
                ) : (
                  <ul className="flex list-none flex-col gap-2 p-0">
                    {row.stage1.finalists.map((finalist) => {
                      const studentVotes =
                        row.stage2.counts.find(
                          (entry) => entry.finalistId === finalist.facultyId,
                        )?.votes ?? 0;
                      return (
                        <li
                          key={finalist.facultyId}
                          className="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm"
                        >
                          <span className="font-medium">
                            #{finalist.rank} {finalist.fullName}
                            {stage2Tie &&
                            stage2Tie.tied.some(
                              (entry) =>
                                entry.finalistId === finalist.facultyId,
                            ) ? (
                              <span className="ml-2 font-semibold text-destructive">
                                Tied for winner
                              </span>
                            ) : stage2TopId === finalist.facultyId ? (
                              <span className="ml-2 font-semibold">Winner</span>
                            ) : null}
                          </span>
                          <span className="text-muted-foreground tabular-nums">
                            {finalist.stage1Votes} faculty · {studentVotes}{" "}
                            student
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )
              ) : row.stage1.counts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No Candidates yet — add faculty to this department first.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-3 py-1 bg-muted/40 rounded-lg">
                    <span>Candidate</span>
                    <span>Vote Tally</span>
                  </div>
                  <ul className="flex flex-col gap-1.5 p-0 list-none">
                    {row.stage1.counts.map((entry, idx) => {
                      const isTop3 = stage1Top3Ids.has(entry.candidateId);
                      const isTied =
                        stage1Tie &&
                        stage1Tie.tied.some(
                          (tiedEntry) =>
                            tiedEntry.candidateId === entry.candidateId,
                        );
                      const showCutoffLine = idx === 3;

                      return (
                        <li key={entry.candidateId}>
                          {showCutoffLine && (
                            <div className="relative my-2.5 flex items-center justify-center">
                              <div className="absolute inset-0 flex items-center">
                                <span className="w-full border-t border-dashed border-primary/40" />
                              </div>
                              <span className="relative bg-card px-2.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                                Top-3 Cutoff Line
                              </span>
                            </div>
                          )}
                          <div
                            className={`flex items-center justify-between p-2.5 rounded-lg border transition-colors ${
                              isTop3
                                ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20"
                                : isTied
                                  ? "border-destructive/40 bg-destructive/10"
                                  : "border-border bg-card hover:bg-muted/30"
                            }`}
                          >
                            <div className="flex items-center gap-2.5">
                              <span
                                className={`flex size-6 items-center justify-center rounded-full text-xs font-bold ${
                                  idx === 0
                                    ? "bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-950 dark:text-amber-300"
                                    : idx === 1
                                      ? "bg-slate-200 text-slate-800 border border-slate-300 dark:bg-slate-800 dark:text-slate-200"
                                      : idx === 2
                                        ? "bg-amber-200/60 text-amber-900 border border-amber-400/50 dark:bg-amber-900/40 dark:text-amber-300"
                                        : "bg-muted text-muted-foreground"
                                }`}
                              >
                                {idx + 1}
                              </span>
                              <span className="text-sm font-medium text-foreground">
                                {entry.fullName}
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              {isTop3 && (
                                <span className="hidden sm:inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200">
                                  Top-3
                                </span>
                              )}
                              {isTied && (
                                <span className="inline-flex items-center rounded-full bg-destructive/20 px-2 py-0.5 text-[10px] font-bold text-destructive">
                                  Tied
                                </span>
                              )}
                              <span className="text-xs font-bold tabular-nums text-foreground bg-muted/60 px-2.5 py-0.5 rounded-md">
                                {entry.votes} {entry.votes === 1 ? "vote" : "votes"}
                              </span>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {row.stage2.published?.published === true ? (
                <div className="rounded-lg border border-primary bg-primary/5 p-3">
                  <p className="text-sm font-semibold">
                    Winner: {row.stage2.published.winnerFullName} (Published)
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {!row.stage2.published?.published ? (
            <DrilldownPublishControl
              electionId={election.id}
              departmentId={row.department.id}
              departmentCode={row.department.code}
              canPublish={canPublish}
              disabledReason={publishDisabledReason}
            />
          ) : null}

          <nav aria-label="Resolve or publish" className="flex flex-wrap gap-2">
            <Link
              href={`/admin/faculty/results${electionQuery}`}
              className="inline-flex h-11 items-center justify-center rounded-lg bg-secondary px-4 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
            >
              Faculty Results — resolve 3rd-place Tie
            </Link>
            <Link
              href={`/admin/final/results${electionQuery}`}
              className="inline-flex h-11 items-center justify-center rounded-lg bg-secondary px-4 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
            >
              Final Results — resolve Winner Tie / publish
            </Link>
            <Link
              href={`/admin/faculty/codes${electionQuery}`}
              className="inline-flex h-11 items-center justify-center rounded-lg bg-secondary px-4 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
            >
              Faculty Codes
            </Link>
            <Link
              href={`/admin/student/codes${electionQuery}`}
              className="inline-flex h-11 items-center justify-center rounded-lg bg-secondary px-4 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
            >
              Student Codes
            </Link>
          </nav>
        </>
      )}
    </section>
  );
}
