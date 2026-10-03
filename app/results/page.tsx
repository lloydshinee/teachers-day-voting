import type { Metadata } from "next";
import { Award, Sparkles, Trophy, Users } from "lucide-react";

import { DepartmentAvatar } from "@/components/department-avatar";
import { FacultyAvatar } from "@/components/faculty-avatar";
import {
  getPublishedResults,
  listPublishedElections,
} from "@/lib/stage2/queries";

export const metadata: Metadata = {
  title: "Published Results",
  description:
    "Published Teachers' Day Winners per department — Winner records plus the frozen Finalists, never live vote rows.",
};

/**
 * Public published-results page (spec §12, task 13).
 *
 * Reads `election_results` + `finalists` only (see `getPublishedResults`) —
 * never live vote rows, never Tokens or Codes. Only departments with a
 * published Winner appear; unpublished departments stay invisible until
 * their admin publishes.
 */
export default async function PublishedResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ election?: string }>;
}) {
  const resolvedParams = await searchParams;
  const listed = await listPublishedElections();

  if (!listed.ok) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Published Results
        </h1>
        <div
          role="alert"
          className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm font-medium text-destructive"
        >
          Could not load published results. Try again.
        </div>
      </main>
    );
  }

  const { elections } = listed;
  if (elections.length === 0) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <Trophy className="size-3.5" />
            <span>Official Honorees</span>
          </div>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Published Results
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            No Winners have been published yet. Check back once voting closes and
            department results are finalized.
          </p>
        </div>

        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/60 p-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground mb-3">
            <Award className="size-6" />
          </div>
          <h2 className="text-base font-semibold text-foreground">
            Awaiting Stage Completion
          </h2>
          <p className="mt-1 text-xs text-muted-foreground max-w-sm">
            Elections advance through faculty peer nominations, finalist
            freezing, and student voting before department winners are officially
            published.
          </p>
        </div>
      </main>
    );
  }

  const first = elections[0];
  if (!first) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-8 sm:px-6 sm:py-12">
        <p role="alert" className="text-sm font-medium text-destructive">
          Could not load published results. Try again.
        </p>
      </main>
    );
  }
  const selectedId =
    typeof resolvedParams.election === "string" &&
    elections.some((election) => election.id === resolvedParams.election)
      ? resolvedParams.election
      : first.id;
  const selected =
    elections.find((election) => election.id === selectedId) ?? first;

  const results = await getPublishedResults(selected.id);
  if (!results.ok) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Published Results
        </h1>
        <p role="alert" className="text-sm font-medium text-destructive">
          Could not load published results. Try again.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div>
        <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
          <Trophy className="size-3.5" />
          <span>Teachers&apos; Day Honorees</span>
        </div>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Published Results
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {results.results.electionName} · {results.results.academicYear} — one
          honored faculty member per published department.
        </p>
      </div>

      {/* Election filter */}
      <div className="rounded-2xl border border-border/80 bg-card p-4 sm:p-5 shadow-xs">
        <form
          method="get"
          action="/results"
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <div className="flex flex-1 flex-col gap-1.5">
            <label
              htmlFor="election-picker"
              className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Select Election
            </label>
            <select
              id="election-picker"
              name="election"
              defaultValue={selected.id}
              className="h-11 w-full min-w-0 rounded-xl border border-input bg-background px-3 py-1 text-base md:text-sm font-medium text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              {elections.map((election) => (
                <option key={election.id} value={election.id}>
                  {election.name} · {election.academicYear}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-xs transition hover:bg-primary/90"
          >
            Show results
          </button>
        </form>
      </div>

      {/* Results content */}
      {results.results.departments.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <p className="text-sm font-medium text-muted-foreground">
            No department winners have been published for this Election yet.
          </p>
        </div>
      ) : (
        <ul className="flex list-none flex-col gap-6 p-0">
          {results.results.departments.map((entry) => (
            <li
              key={entry.department.id}
              className="overflow-hidden rounded-2xl border border-border/90 bg-card shadow-sm transition hover:shadow-md"
            >
              {/* Department Header */}
              <div className="border-b border-border/70 bg-muted/40 px-5 py-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <DepartmentAvatar
                    name={entry.department.name}
                    code={entry.department.code}
                    url={entry.department.pictureUrl}
                    size="sm"
                  />
                  <div>
                    <h2 className="text-base font-bold text-foreground">
                      {entry.department.name}
                    </h2>
                    <span className="text-[11px] font-semibold text-primary">
                      {entry.department.code}
                    </span>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
                  <Sparkles className="size-3.5" />
                  Honoree Declared
                </span>
              </div>

              {/* Department Winner Card */}
              <div className="p-5">
                <div className="rounded-xl border border-primary/25 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4 sm:p-5 flex items-center gap-4">
                  <div className="relative">
                    <FacultyAvatar
                      name={entry.winner.fullName}
                      url={entry.winner.pictureUrl}
                      size="lg"
                    />
                    <div className="absolute -bottom-1 -right-1 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xs">
                      <Trophy className="size-3.5" />
                    </div>
                  </div>
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-primary">
                      Department Winner &amp; Honoree
                    </span>
                    <h3 className="text-lg sm:text-xl font-extrabold text-foreground">
                      {entry.winner.fullName}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Selected through department student voting from the Top-3
                      finalists.
                    </p>
                  </div>
                </div>

                {/* Finalists list */}
                {entry.finalists.length > 0 ? (
                  <div className="mt-5 border-t border-border/70 pt-4">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                      <Users className="size-3.5" />
                      <span>Department Finalists</span>
                    </h4>
                    <ul className="flex list-none flex-col gap-2 p-0">
                      {entry.finalists.map((finalist) => {
                        const isWinner =
                          finalist.facultyId === entry.winner.facultyId;
                        return (
                          <li
                            key={finalist.facultyId}
                            className={`flex items-center justify-between rounded-xl px-3.5 py-2.5 text-sm transition ${
                              isWinner
                                ? "bg-primary/10 font-bold text-primary border border-primary/20"
                                : "bg-muted/40 font-medium text-foreground hover:bg-muted"
                            }`}
                          >
                            <span className="flex items-center gap-3">
                              <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-background text-[11px] font-bold text-muted-foreground border">
                                #{finalist.rank}
                              </span>
                              <FacultyAvatar
                                name={finalist.fullName}
                                url={finalist.pictureUrl}
                                size="sm"
                              />
                              <span>{finalist.fullName}</span>
                            </span>
                            {isWinner ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground shadow-2xs">
                                <Trophy className="size-3" />
                                Winner
                              </span>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
