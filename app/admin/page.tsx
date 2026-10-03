import type { Metadata } from "next";
import Link from "next/link";

import { DepartmentAvatar } from "@/components/department-avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getElectionDashboard } from "@/lib/dashboard/queries";
import { listDepartmentsWithCounts } from "@/lib/departments/queries";
import { listElections } from "@/lib/election/queries";
import type { ElectionStage } from "@/lib/election/stages";

import {
  CreateElectionButton,
  ElectionStageControls,
} from "./election-forms";

export const metadata: Metadata = {
  title: "Election Dashboard · Admin",
  description:
    "Admin Election dashboard: stage status banner with per-department Tie flags, participation counts, and department drill-down.",
};

/**
 * Admin Election dashboard (spec §14 task 14, structure §9).
 *
 * Aggregates only (spec §7): every number comes from the dashboard query
 * composition over the existing aggregate-only modules — no voter-level rows
 * reach this view. Tie resolution and Winner publishing live on the Faculty
 * Results / Final Results pages; this page links to them with the Election
 * context preserved.
 */
export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ election?: string }>;
}) {
  const resolvedParams = await searchParams;
  const [electionsResult, departmentsResult] = await Promise.all([
    listElections(),
    listDepartmentsWithCounts(),
  ]);

  const departmentOptions = departmentsResult.ok
    ? departmentsResult.departments
    : [];

  if (!electionsResult.ok) {
    const isDenied =
      electionsResult.code === "UNAUTHENTICATED" ||
      electionsResult.code === "FORBIDDEN";
    return (
      <section aria-labelledby="dashboard-heading" className="flex flex-col gap-4">
        <div>
          <h1
            id="dashboard-heading"
            className="text-2xl font-semibold tracking-tight"
          >
            Election Dashboard
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Stage status, participation counts, and per-department Tie flags.
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
      <section aria-labelledby="dashboard-heading" className="flex flex-col gap-6">
        <div>
          <h1
            id="dashboard-heading"
            className="text-2xl font-semibold tracking-tight"
          >
            Election Dashboard
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Stage status, participation counts, and per-department Tie flags.
          </p>
        </div>

        <Card className="border-dashed bg-card/60">
          <CardContent className="flex flex-col items-center justify-center p-8 text-center sm:p-12">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 20V6a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v14" />
                <path d="M2 20h20" />
                <path d="M14 12v.01" />
              </svg>
            </div>
            <h2 className="mt-4 text-lg font-semibold tracking-tight">
              No Elections Created Yet
            </h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              Create your first election to start the Teachers&apos; Day voting cycle.
              You can configure the academic year, participating colleges, and manage
              both faculty peer voting and student finalist voting.
            </p>
            <div className="mt-6">
              <CreateElectionButton
                departments={departmentOptions}
                variant="primary"
                label="+ Create First Election"
              />
            </div>
          </CardContent>
        </Card>
      </section>
    );
  }

  const first = elections[0];
  if (!first) {
    return (
      <section aria-labelledby="dashboard-heading" className="flex flex-col gap-4">
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

  const dashboard = await getElectionDashboard(selected.id);
  if (!dashboard.ok) {
    const isDenied =
      dashboard.code === "UNAUTHENTICATED" || dashboard.code === "FORBIDDEN";
    return (
      <section aria-labelledby="dashboard-heading" className="flex flex-col gap-4">
        <div>
          <h1
            id="dashboard-heading"
            className="text-2xl font-semibold tracking-tight"
          >
            Election Dashboard
          </h1>
        </div>
        <p role="alert" className="text-sm font-medium text-destructive">
          {isDenied
            ? dashboard.message
            : "Could not load the dashboard. Try again."}
        </p>
      </section>
    );
  }

  const { election, policyVersion, departments, totals } = dashboard.dashboard;
  const tiedDepartments = departments.filter(
    (row) => row.participating && (row.stage1Tie || row.stage2Tie),
  );
  const electionQuery = `?election=${encodeURIComponent(election.id)}`;

  return (
    <section aria-labelledby="dashboard-heading" className="flex flex-col gap-4">
      <div>
        <h1 id="dashboard-heading" className="text-2xl font-semibold tracking-tight">
          Election Dashboard
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Aggregates only — participation counts and Tie flags, never
          voter-to-choice.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <form
          method="get"
          action="/admin"
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
              {elections.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} · {entry.academic_year} · {entry.stage}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="inline-flex h-11 items-center justify-center rounded-lg bg-secondary px-4 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
          >
            Show dashboard
          </button>
        </form>

        <CreateElectionButton
          departments={departmentOptions}
          label="+ New Election"
        />
      </div>

      <ElectionStageControls
        electionId={selected.id}
        stage={election.stage as ElectionStage}
      />

      <Card>
        <CardHeader>
          <CardTitle>
            {election.name} · {election.academicYear}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Stage: {election.stage} · Tie policy:{" "}
            {policyVersion === null
              ? "not frozen yet"
              : `frozen at ${policyVersion}`}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {tiedDepartments.length === 0 ? (
            <p role="status" className="text-sm font-medium">
              No Ties pending — every department advances normally.
            </p>
          ) : (
            <div
              role="alert"
              className="rounded-lg border border-destructive bg-destructive/10 p-3"
            >
              <p className="text-sm font-semibold text-destructive">
                Tie detected in {tiedDepartments.length} department
                {tiedDepartments.length === 1 ? "" : "s"}
              </p>
              <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-sm text-destructive">
                {tiedDepartments.map((row) => (
                  <li key={row.department.id}>
                    {row.department.code}
                    {row.stage1Tie && row.stage2Tie
                      ? " — Tie detected for 3rd place and Tie detected for winner"
                      : row.stage1Tie
                        ? " — Tie detected for 3rd place"
                        : " — Tie detected for winner"}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div className="rounded-lg border p-3">
              <dt className="text-muted-foreground">Departments</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">
                {totals.departments}
              </dd>
            </div>
            <div className="rounded-lg border p-3">
              <dt className="text-muted-foreground">Faculty</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">
                {totals.facultyEligible}
              </dd>
            </div>
            <div className="rounded-lg border p-3">
              <dt className="text-muted-foreground">Faculty votes</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">
                {totals.facultyVotes} / {totals.facultyEligible}
              </dd>
              <dd className="text-xs text-muted-foreground">
                cast versus eligible
              </dd>
            </div>
            <div className="rounded-lg border p-3">
              <dt className="text-muted-foreground">Student votes</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">
                {totals.studentVotes} / {totals.studentCodesGenerated}
              </dd>
              <dd className="text-xs text-muted-foreground">
                cast versus generated
              </dd>
            </div>
          </dl>
          <p className="text-sm text-muted-foreground">
            {totals.departmentsLocked} with locked Finalists ·{" "}
            {totals.departmentsPublished} Winners published
          </p>
        </CardContent>
      </Card>

      <nav aria-label="Election sections" className="flex flex-wrap gap-2">
        <Link
          href="/admin/departments"
          className="inline-flex h-11 items-center justify-center rounded-lg bg-secondary px-4 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
        >
          Departments
        </Link>
        <Link
          href="/admin/faculty"
          className="inline-flex h-11 items-center justify-center rounded-lg bg-secondary px-4 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
        >
          Faculty
        </Link>
        <Link
          href={`/admin/faculty/codes${electionQuery}`}
          className="inline-flex h-11 items-center justify-center rounded-lg bg-secondary px-4 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
        >
          Faculty Codes
        </Link>
        <Link
          href={`/admin/faculty/results${electionQuery}`}
          className="inline-flex h-11 items-center justify-center rounded-lg bg-secondary px-4 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
        >
          Faculty Results
        </Link>
        <Link
          href={`/admin/student/codes${electionQuery}`}
          className="inline-flex h-11 items-center justify-center rounded-lg bg-secondary px-4 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
        >
          Student Codes
        </Link>
        <Link
          href={`/admin/final/results${electionQuery}`}
          className="inline-flex h-11 items-center justify-center rounded-lg bg-secondary px-4 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
        >
          Final Results
        </Link>
      </nav>

      <h2 className="mt-2 text-lg font-semibold tracking-tight">
        Departments ({departments.length})
      </h2>
      {departments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No departments yet. Add departments first.
        </p>
      ) : (
        <ul className="flex list-none flex-col gap-4 p-0">
          {departments.map((row) => (
            <li key={row.department.id}>
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <DepartmentAvatar
                      name={row.department.name}
                      code={row.department.code}
                      url={row.department.picture_url}
                      size="sm"
                    />
                    <div>
                      <CardTitle>
                        {row.department.code} · {row.department.name}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {!row.participating
                          ? "Not participating in this Election."
                          : [
                              `${row.facultyCodes.eligibleCount} faculty`,
                              `${row.stage1.totalVotes} faculty votes`,
                              `${row.stage2.totalVotes} student votes`,
                              row.finalistsLockedAt !== null
                                ? "Finalists frozen"
                                : "Finalists not frozen",
                              row.winnerPublished ? "Winner published" : null,
                            ]
                              .filter((part) => part !== null)
                              .join(" · ")}
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {row.participating && (row.stage1Tie || row.stage2Tie) ? (
                    <p role="alert" className="text-sm font-semibold text-destructive">
                      {row.stage1Tie && row.stage2Tie
                        ? "Tie detected for 3rd place · Tie detected for winner"
                        : row.stage1Tie
                          ? "Tie detected for 3rd place"
                          : "Tie detected for winner"}
                    </p>
                  ) : null}
                  <Link
                    href={`/admin/departments/${row.department.id}${electionQuery}`}
                    className="inline-flex h-11 items-center justify-center rounded-lg bg-secondary px-4 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 sm:w-auto sm:self-start"
                  >
                    Open drill-down ({row.department.code})
                  </Link>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
