"use client";

import { useActionState, useState } from "react";

import { DepartmentAvatar } from "@/components/department-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  closeFacultyVoting,
  freezeStage1Finalists,
  reopenStage1,
  resolveStage1Tie,
} from "@/lib/stage1/actions";
import type {
  Stage1DepartmentTally,
  Stage1ResultsTotals,
} from "@/lib/stage1/queries";
import type { Stage1ActionState } from "@/lib/stage1/schemas";

/**
 * Client controls for Stage-1 results (spec §14 task 10).
 *
 * Aggregates only: this module renders per-Candidate vote totals and the
 * frozen Finalists — no voter-side data exists on this path by construction
 * (spec §7). Every mutation is a serializable Server Action state via
 * `useActionState`; the counting itself (Top-3, cutoff Tie) is computed
 * server-side in `./queries`/`./actions` and revalidated after each write.
 */

const INITIAL_STATE: Stage1ActionState = { ok: true, message: "" };

function ActionMessage({ state }: { state: Stage1ActionState }) {
  if (state.ok) {
    if (state.message === "") {
      return null;
    }
    return (
      <p role="status" aria-live="polite" className="text-sm font-medium">
        {state.message}
      </p>
    );
  }
  return (
    <p role="alert" className="text-sm font-medium text-destructive">
      {state.message}
    </p>
  );
}

export function CloseFacultyVotingForm({ electionId }: { electionId: string }) {
  const [state, formAction, isPending] = useActionState(
    closeFacultyVoting,
    INITIAL_STATE,
  );
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="electionId" value={electionId} />
      <ActionMessage state={state} />
      <Button
        type="submit"
        disabled={isPending}
        className="h-11 w-full sm:w-auto"
      >
        {isPending ? "Closing…" : "Close faculty voting"}
      </Button>
    </form>
  );
}

function FreezeFinalistsForm({
  electionId,
  departmentId,
  departmentCode,
}: {
  electionId: string;
  departmentId: string;
  departmentCode: string;
}) {
  const [state, formAction, isPending] = useActionState(
    freezeStage1Finalists,
    INITIAL_STATE,
  );
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="electionId" value={electionId} />
      <input type="hidden" name="departmentId" value={departmentId} />
      <ActionMessage state={state} />
      <Button
        type="submit"
        variant="outline"
        disabled={isPending}
        className="h-11 w-full sm:w-auto"
      >
        {isPending ? "Freezing…" : `Freeze Top-3 as Finalists (${departmentCode})`}
      </Button>
    </form>
  );
}

function ResolveTieForm({
  electionId,
  departmentId,
  tied,
  seatsRemaining,
  cutoffVotes,
}: {
  electionId: string;
  departmentId: string;
  tied: Array<{ candidateId: string; fullName: string; votes: number }>;
  seatsRemaining: number;
  cutoffVotes: number;
}) {
  const [state, formAction, isPending] = useActionState(
    resolveStage1Tie,
    INITIAL_STATE,
  );
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());

  const toggle = (candidateId: string) => {
    setChecked((previous) => {
      const next = new Set(previous);
      if (next.has(candidateId)) {
        next.delete(candidateId);
      } else {
        next.add(candidateId);
      }
      return next;
    });
  };

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="electionId" value={electionId} />
      <input type="hidden" name="departmentId" value={departmentId} />
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold tracking-tight">
          Pick exactly {seatsRemaining} of the {tied.length} tied Candidates
          ({cutoffVotes} votes each)
        </legend>
        <p className="text-xs text-muted-foreground">
          Manual Tie pick only — Ties never auto-resolve. Only the tied
          Candidates below are eligible.
        </p>
        <ul className="flex list-none flex-col gap-2 p-0">
          {tied.map((entry) => (
            <li key={entry.candidateId}>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm font-medium has-checked:border-primary">
                <input
                  type="checkbox"
                  name="pickedCandidateIds"
                  value={entry.candidateId}
                  checked={checked.has(entry.candidateId)}
                  onChange={() => toggle(entry.candidateId)}
                  className="h-5 w-5 accent-primary"
                />
                <span>
                  {entry.fullName}
                  <span className="ml-2 text-muted-foreground">
                    {entry.votes} vote{entry.votes === 1 ? "" : "s"}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <ActionMessage state={state} />
      <Button
        type="submit"
        disabled={isPending || checked.size !== seatsRemaining}
        className="h-11 w-full sm:w-auto"
      >
        {isPending
          ? "Resolving…"
          : `Resolve Tie — advance ${seatsRemaining} Candidate${seatsRemaining === 1 ? "" : "s"}`}
      </Button>
      {checked.size !== seatsRemaining ? (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          Select exactly {seatsRemaining} tied Candidate
          {seatsRemaining === 1 ? "" : "s"} to continue ({checked.size}{" "}
          selected).
        </p>
      ) : null}
    </form>
  );
}

function ReopenStage1Form({
  electionId,
  departmentId,
  departmentCode,
}: {
  electionId: string;
  departmentId: string;
  departmentCode: string;
}) {
  const [state, formAction, isPending] = useActionState(
    reopenStage1,
    INITIAL_STATE,
  );
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="electionId" value={electionId} />
      <input type="hidden" name="departmentId" value={departmentId} />
      <ActionMessage state={state} />
      <Button
        type="submit"
        variant="outline"
        disabled={isPending}
        className="h-11 w-full sm:w-auto"
      >
        {isPending ? "Re-opening…" : `Re-open Stage 1 (${departmentCode})`}
      </Button>
      <p className="text-xs text-muted-foreground">
        Allowed only with zero student votes here. Unfreezes the snapshot (the
        prior one is marked superseded in audit) and requires a fresh freeze.
        Votes are kept.
      </p>
    </form>
  );
}

function DepartmentResultsCard({
  electionId,
  stage,
  tally,
}: {
  electionId: string;
  stage: string;
  tally: Stage1DepartmentTally;
}) {
  const tied = tally.cutoff.kind === "tie" ? tally.cutoff : null;
  const locked = tally.finalistsLockedAt !== null;
  const freezableStage =
    stage === "FACULTY_RESULTS" ||
    stage === "STUDENT_VOTING" ||
    stage === "FINAL_RESULTS";
  const top3Ids =
    tally.cutoff.kind === "clean"
      ? new Set(tally.cutoff.top3.map((entry) => entry.candidateId))
      : new Set<string>();

  return (
    <Card className="shadow-xs overflow-hidden">
      <CardHeader>
        <div className="flex items-center gap-3">
          <DepartmentAvatar
            name={tally.department.name}
            code={tally.department.code}
            url={tally.department.picture_url}
            size="md"
          />
          <div>
            <CardTitle>
              {tally.department.code} · {tally.department.name}
            </CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {tally.totalVotes === 1
                ? "1 faculty vote"
                : `${tally.totalVotes} faculty votes`}
              {` · ${tally.counts.length} Candidates`}
              {locked ? " · Finalists frozen" : ""}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {tally.tiePending && tied ? (
          <div
            role="alert"
            className="rounded-xl border border-destructive/40 bg-destructive/10 p-3.5"
          >
            <p className="text-sm font-bold text-destructive">
              ⚠️ Cutoff Tie Detected for 3rd Place
            </p>
            <p className="mt-1 text-xs text-destructive">
              {tied.tied.length} Candidates share {tied.cutoffVotes} votes with{" "}
              {tied.seatsRemaining} seat{tied.seatsRemaining === 1 ? "" : "s"} left.
              Ties never auto-resolve — manually pick from the tied Candidates below.
            </p>
          </div>
        ) : null}

        {tally.counts.length === 0 ? (
          <p className="text-sm text-muted-foreground py-3 text-center">
            No Candidates yet — add faculty to this department first.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-3 py-1 bg-muted/40 rounded-lg">
              <span>Candidate</span>
              <span>Vote Tally</span>
            </div>
            <ul className="flex flex-col gap-1.5 p-0 list-none">
              {tally.counts.map((entry, idx) => {
                const isTop3 =
                  tally.cutoff.kind === "clean" && top3Ids.has(entry.candidateId);
                const isTied =
                  tied &&
                  tied.tied.some((t) => t.candidateId === entry.candidateId);
                const showCutoffLine = idx === 3 && tally.cutoff.kind === "clean";

                return (
                  <li key={entry.candidateId}>
                    {showCutoffLine && (
                      <div className="relative my-2.5 flex items-center justify-center">
                        <div className="absolute inset-0 flex items-center">
                          <span className="w-full border-t border-dashed border-primary/40" />
                        </div>
                        <span className="relative bg-card px-2.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                          Top-3 Advancement Cutoff
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
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
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
                        <span className="text-sm font-medium text-foreground truncate">
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

        {locked ? (
          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold tracking-tight">
              Frozen Finalists ({tally.finalists.length})
            </h3>
            {tally.finalists.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Frozen with no Finalists (no Candidates at close time).
              </p>
            ) : (
              <ul className="mt-2.5 flex list-none flex-col gap-2 p-0">
                {tally.finalists.map((finalist) => (
                  <li
                    key={finalist.facultyId}
                    className="flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
                        {finalist.rank}
                      </span>
                      <span className="font-semibold text-foreground">
                        {finalist.fullName}
                      </span>
                    </div>
                    <span className="text-xs font-medium text-muted-foreground tabular-nums bg-background border px-2 py-0.5 rounded">
                      {finalist.stage1Votes} {finalist.stage1Votes === 1 ? "vote" : "votes"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {freezableStage ? (
              <div className="mt-3">
                <ReopenStage1Form
                  electionId={electionId}
                  departmentId={tally.department.id}
                  departmentCode={tally.department.code}
                />
              </div>
            ) : null}
          </div>
        ) : tied && tally.tiePending ? (
          <div className="border-t pt-4">
            <ResolveTieForm
              electionId={electionId}
              departmentId={tally.department.id}
              tied={tied.tied}
              seatsRemaining={tied.seatsRemaining}
              cutoffVotes={tied.cutoffVotes}
            />
          </div>
        ) : freezableStage ? (
          <FreezeFinalistsForm
            electionId={electionId}
            departmentId={tally.department.id}
            departmentCode={tally.department.code}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Freezing opens after faculty voting closes.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function FacultyResultsClient({
  electionId,
  stage,
  policyVersion,
  departments,
  totals,
}: {
  electionId: string;
  stage: string;
  policyVersion: string | null;
  departments: Stage1DepartmentTally[];
  totals: Stage1ResultsTotals;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Faculty voting gate</CardTitle>
          <p className="text-sm text-muted-foreground">
            Election stage: {stage} · Tie policy:{" "}
            {policyVersion === null
              ? "not frozen yet"
              : `frozen at ${policyVersion}`}
          </p>
          <p className="text-sm text-muted-foreground">
            {totals.facultyVotes === 1
              ? "1 faculty vote"
              : `${totals.facultyVotes} faculty votes`}
            {` · ${totals.departments} departments · ${totals.locked} frozen · ${totals.tied} tied`}
          </p>
        </CardHeader>
        {stage === "FACULTY_VOTING" ? (
          <CardContent>
            <CloseFacultyVotingForm electionId={electionId} />
          </CardContent>
        ) : null}
      </Card>

      <h2 className="mt-2 text-lg font-semibold tracking-tight">
        Results by department
      </h2>
      {departments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No departments yet. Add departments first.
        </p>
      ) : (
        <ul className="flex list-none flex-col gap-4 p-0">
          {departments.map((tally) => (
            <li key={tally.department.id}>
              {tally.participating ? (
                <DepartmentResultsCard
                  electionId={electionId}
                  stage={stage}
                  tally={tally}
                />
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle>
                      {tally.department.code} · {tally.department.name}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      Not participating in this Election — no Stage-1 counting
                      here.
                    </p>
                  </CardHeader>
                </Card>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
