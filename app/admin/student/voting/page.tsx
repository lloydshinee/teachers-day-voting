import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getElectionDashboard } from "@/lib/dashboard/queries";
import { listElections } from "@/lib/election/queries";

export const metadata: Metadata = {
  title: "Student Voting · Admin",
  description:
    "Admin monitoring of Stage-2 student voting participation and department status.",
};

export default async function AdminStudentVotingPage({
  searchParams,
}: {
  searchParams: Promise<{ election?: string }>;
}) {
  const resolvedParams = await searchParams;
  const electionsResult = await listElections();

  if (!electionsResult.ok) {
    const isDenied =
      electionsResult.code === "UNAUTHENTICATED" ||
      electionsResult.code === "FORBIDDEN";
    return (
      <section aria-labelledby="student-voting-heading" className="flex flex-col gap-4">
        <div>
          <h1
            id="student-voting-heading"
            className="text-2xl font-semibold tracking-tight"
          >
            Student Voting (Stage 2)
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Monitor student voting participation across participating departments.
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
      <section aria-labelledby="student-voting-heading" className="flex flex-col gap-4">
        <div>
          <h1
            id="student-voting-heading"
            className="text-2xl font-semibold tracking-tight"
          >
            Student Voting (Stage 2)
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
      <section aria-labelledby="student-voting-heading" className="flex flex-col gap-4">
        <p role="alert" className="text-sm font-medium text-destructive">
          Could not load Elections. Try again.
        </p>
      </section>
    );
  }
  const selectedId =
    typeof resolvedParams.election === "string" &&
    elections.some((election) => election.id === resolvedParams.election)
      ? resolvedParams.election
      : first.id;
  const selected =
    elections.find((election) => election.id === selectedId) ?? first;

  const dashboardResult = await getElectionDashboard(selected.id);
  if (!dashboardResult.ok) {
    const isDenied =
      dashboardResult.code === "UNAUTHENTICATED" ||
      dashboardResult.code === "FORBIDDEN";
    return (
      <section aria-labelledby="student-voting-heading" className="flex flex-col gap-4">
        <div>
          <h1
            id="student-voting-heading"
            className="text-2xl font-semibold tracking-tight"
          >
            Student Voting (Stage 2)
          </h1>
        </div>
        <p role="alert" className="text-sm font-medium text-destructive">
          {isDenied ? dashboardResult.message : "Could not load dashboard. Try again."}
        </p>
      </section>
    );
  }

  const { election, departments, totals } = dashboardResult.dashboard;
  const electionQuery = `?election=${encodeURIComponent(election.id)}`;

  return (
    <section aria-labelledby="student-voting-heading" className="flex flex-col gap-4">
      <div>
        <h1
          id="student-voting-heading"
          className="text-2xl font-semibold tracking-tight"
        >
          Student Voting (Stage 2)
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Aggregates only — students vote among each department&apos;s frozen Top-3
          Finalists using department-bound Codes.
        </p>
      </div>

      <form
        method="get"
        action="/admin/student/voting"
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
      >
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="election-picker"
            className="text-sm font-medium leading-none"
          >
            Election
          </label>
          <select
            id="election-picker"
            name="election"
            defaultValue={selected.id}
            className="h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-1 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
          >
            {elections.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.academic_year} · {item.stage}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="inline-flex h-11 items-center justify-center rounded-lg bg-secondary px-4 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
        >
          Show Status
        </button>
      </form>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Current Stage
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">{election.stage}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {election.stage === "STUDENT_VOTING"
                ? "Active — student votes are being cast"
                : "Student voting is not open"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Student Votes Cast
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold tabular-nums">
              {totals.studentVotes} / {totals.studentCodesGenerated}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Votes cast versus Codes generated
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Locked Finalist Snapshot
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold tabular-nums">
              {totals.departmentsLocked} / {totals.departments}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Departments with frozen Top-3
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href={`/admin/student/codes${electionQuery}`}
          className="inline-flex h-10 items-center justify-center rounded-lg bg-secondary px-4 text-xs font-medium text-secondary-foreground hover:bg-secondary/80"
        >
          Manage Student Codes
        </Link>
        <Link
          href={`/admin/final/results${electionQuery}`}
          className="inline-flex h-10 items-center justify-center rounded-lg bg-secondary px-4 text-xs font-medium text-secondary-foreground hover:bg-secondary/80"
        >
          View Final Results &amp; Publish
        </Link>
      </div>

      <h2 className="mt-4 text-lg font-semibold tracking-tight">
        Department Student Participation
      </h2>

      <div className="flex flex-col gap-3">
        {departments
          .filter((d) => d.participating)
          .map((row) => (
            <Card key={row.department.id}>
              <CardContent className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 gap-3">
                <div>
                  <h3 className="font-semibold text-sm">
                    {row.department.code} · {row.department.name}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {row.stage2.totalVotes} student votes cast ·{" "}
                    {row.studentCodes.generated} Codes generated (
                    {row.studentCodes.used} used, {row.studentCodes.remaining} remaining)
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      row.finalistsLockedAt !== null
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {row.finalistsLockedAt !== null
                      ? "Finalists Frozen"
                      : "Finalists Not Frozen"}
                  </span>
                  <Link
                    href={`/admin/departments/${row.department.id}${electionQuery}`}
                    className="inline-flex h-9 items-center justify-center rounded-lg border border-input bg-background px-3 text-xs font-medium hover:bg-muted"
                  >
                    Drill-down
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
      </div>
    </section>
  );
}
