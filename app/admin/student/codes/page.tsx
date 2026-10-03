import type { Metadata } from "next";

import { listElections } from "@/lib/election/queries";
import { getStudentCodeStatus } from "@/lib/student/code-queries";

import { StudentCodesClient } from "./forms";

export const metadata: Metadata = {
  title: "Student Codes · Admin",
  description:
    "Admin generation and per-department status of student voting Codes.",
};

export default async function AdminStudentCodesPage({
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
      <section aria-labelledby="codes-heading" className="flex flex-col gap-4">
        <div>
          <h1
            id="codes-heading"
            className="text-2xl font-semibold tracking-tight"
          >
            Student Codes
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Generate department student voting Codes in chosen quantities and
            track per-department Code status.
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
      <section aria-labelledby="codes-heading" className="flex flex-col gap-4">
        <div>
          <h1
            id="codes-heading"
            className="text-2xl font-semibold tracking-tight"
          >
            Student Codes
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            No Elections yet. Create an Election first, then generate student
            voting Codes here.
          </p>
        </div>
      </section>
    );
  }

  const first = elections[0];
  if (!first) {
    return (
      <section aria-labelledby="codes-heading" className="flex flex-col gap-4">
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

  const status = await getStudentCodeStatus(selected.id);
  if (!status.ok) {
    const isDenied =
      status.code === "UNAUTHENTICATED" || status.code === "FORBIDDEN";
    return (
      <section aria-labelledby="codes-heading" className="flex flex-col gap-4">
        <div>
          <h1
            id="codes-heading"
            className="text-2xl font-semibold tracking-tight"
          >
            Student Codes
          </h1>
        </div>
        <p role="alert" className="text-sm font-medium text-destructive">
          {isDenied ? status.message : "Could not load Code status. Try again."}
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="codes-heading" className="flex flex-col gap-4">
      <div className="print:hidden">
        <h1 id="codes-heading" className="text-2xl font-semibold tracking-tight">
          Student Codes
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Each generation creates exactly the requested number of new
          department-bound Codes — top-ups only add, never duplicate. New
          Codes are shown once with their QR: export or print them
          immediately.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {status.totals.generated === 1
            ? "1 Code generated"
            : `${status.totals.generated} Codes generated`}
          {` · ${status.totals.used} used · ${status.totals.remaining} remaining`}
          {status.totals.invalidated > 0
            ? ` · ${status.totals.invalidated} invalidated`
            : ""}
        </p>
      </div>

      <form
        method="get"
        action="/admin/student/codes"
        className="print:hidden flex flex-col gap-2 sm:flex-row sm:items-end"
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
            {elections.map((election) => (
              <option key={election.id} value={election.id}>
                {election.name} · {election.academic_year} · {election.stage}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="inline-flex h-11 items-center justify-center rounded-lg bg-secondary px-4 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
        >
          Show Codes
        </button>
      </form>

      <StudentCodesClient
        electionId={selected.id}
        statuses={status.statuses}
        totals={status.totals}
      />
    </section>
  );
}
