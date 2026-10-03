import type { Metadata } from "next";

import { listElections } from "@/lib/election/queries";
import { getStage1Results } from "@/lib/stage1/queries";

import { FacultyResultsClient } from "./forms";

export const metadata: Metadata = {
  title: "Faculty Results · Admin",
  description:
    "Admin Stage-1 counting: per-department Top-3, Tie resolution, and Finalist freeze.",
};

export default async function AdminFacultyResultsPage({
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
      <section aria-labelledby="results-heading" className="flex flex-col gap-4">
        <div>
          <h1
            id="results-heading"
            className="text-2xl font-semibold tracking-tight"
          >
            Faculty Results
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Stage-1 counting per department: Top-3, cutoff Ties, and the frozen
            Finalist snapshot.
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
      <section aria-labelledby="results-heading" className="flex flex-col gap-4">
        <div>
          <h1
            id="results-heading"
            className="text-2xl font-semibold tracking-tight"
          >
            Faculty Results
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            No Elections yet. Create an Election first, then Stage-1 results
            appear here.
          </p>
        </div>
      </section>
    );
  }

  const first = elections[0];
  if (!first) {
    return (
      <section aria-labelledby="results-heading" className="flex flex-col gap-4">
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

  const results = await getStage1Results(selected.id);
  if (!results.ok) {
    const isDenied =
      results.code === "UNAUTHENTICATED" || results.code === "FORBIDDEN";
    return (
      <section aria-labelledby="results-heading" className="flex flex-col gap-4">
        <div>
          <h1
            id="results-heading"
            className="text-2xl font-semibold tracking-tight"
          >
            Faculty Results
          </h1>
        </div>
        <p role="alert" className="text-sm font-medium text-destructive">
          {isDenied ? results.message : "Could not load results. Try again."}
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="results-heading" className="flex flex-col gap-4">
      <div>
        <h1 id="results-heading" className="text-2xl font-semibold tracking-tight">
          Faculty Results
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Aggregates only — per-Candidate totals, never voter-to-choice. A
          cutoff Tie holds its department until an admin picks from exactly
          the tied Candidates.
        </p>
      </div>

      <form
        method="get"
        action="/admin/faculty/results"
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
          Show results
        </button>
      </form>

      <FacultyResultsClient
        electionId={results.results.electionId}
        stage={results.results.stage}
        policyVersion={results.results.policyVersion}
        departments={results.results.departments}
        totals={results.results.totals}
      />
    </section>
  );
}
