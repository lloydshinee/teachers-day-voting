"use client";

import { useActionState, useState } from "react";
import { Award, Trophy } from "lucide-react";

import { DepartmentAvatar } from "@/components/department-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  closeStudentVoting,
  flagStage2Tie,
  publishStage2Winner,
  resolveStage2Tie,
} from "@/lib/stage2/actions";
import type {
  Stage2DepartmentTally,
  Stage2ResultsTotals,
} from "@/lib/stage2/queries";
import type { Stage2ActionState } from "@/lib/stage2/schemas";

/**
 * Client controls for Stage-2 results (spec §14 task 13).
 *
 * Aggregates only: this module renders per-Finalist student-vote totals,
 * the Winner/Tie state, and the published Winners — no voter-side data
 * exists on this path by construction (spec §7). Every mutation is a
 * serializable Server Action state via `useActionState`; the counting
 * itself (Winner, Winner Tie) is computed server-side in
 * `./queries`/`./actions` and revalidated after each write.
 */

const INITIAL_STATE: Stage2ActionState = { ok: true, message: "" };

function ActionMessage({ state }: { state: Stage2ActionState }) {
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

export function CloseStudentVotingForm({ electionId }: { electionId: string }) {
  const [state, formAction, isPending] = useActionState(
    closeStudentVoting,
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
        {isPending ? "Closing…" : "Close student voting"}
      </Button>
    </form>
  );
}

function FlagTieForm({
  electionId,
  departmentId,
  departmentCode,
}: {
  electionId: string;
  departmentId: string;
  departmentCode: string;
}) {
  const [state, formAction, isPending] = useActionState(
    flagStage2Tie,
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
        {isPending ? "Flagging…" : `Flag Winner Tie (${departmentCode})`}
      </Button>
      <p className="text-xs text-muted-foreground">
        Flags the department as tie-pending so the Winner Tie can be resolved
        below. Ties never auto-resolve.
      </p>
    </form>
  );
}

function ResolveTieForm({
  electionId,
  departmentId,
  tied,
  topVotes,
}: {
  electionId: string;
  departmentId: string;
  tied: Array<{ finalistId: string; fullName: string; votes: number }>;
  topVotes: number;
}) {
  const [state, formAction, isPending] = useActionState(
    resolveStage2Tie,
    INITIAL_STATE,
  );
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="electionId" value={electionId} />
      <input type="hidden" name="departmentId" value={departmentId} />
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold tracking-tight">
          Pick exactly one of the {tied.length} tied Finalists ({topVotes}{" "}
          votes each)
        </legend>
        <p className="text-xs text-muted-foreground">
          Manual Tie pick only — Ties never auto-resolve. Only the tied
          Finalists below are eligible.
        </p>
        <ul className="flex list-none flex-col gap-2 p-0">
          {tied.map((entry) => (
            <li key={entry.finalistId}>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm font-medium has-checked:border-primary">
                <input
                  type="radio"
                  name="pickedFinalistId"
                  value={entry.finalistId}
                  checked={picked === entry.finalistId}
                  onChange={() => setPicked(entry.finalistId)}
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
        disabled={isPending || picked === null}
        className="h-11 w-full sm:w-auto"
      >
        {isPending ? "Resolving…" : "Resolve Tie — pick Winner"}
      </Button>
      {picked === null ? (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          Select exactly one tied Finalist to continue.
        </p>
      ) : null}
    </form>
  );
}

function PublishWinnerForm({
  electionId,
  departmentId,
  departmentCode,
}: {
  electionId: string;
  departmentId: string;
  departmentCode: string;
}) {
  const [state, formAction, isPending] = useActionState(
    publishStage2Winner,
    INITIAL_STATE,
  );
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="electionId" value={electionId} />
      <input type="hidden" name="departmentId" value={departmentId} />
      <ActionMessage state={state} />
      <Button
        type="submit"
        disabled={isPending}
        className="h-11 w-full sm:w-auto"
      >
        {isPending ? "Publishing…" : `Publish Winner (${departmentCode})`}
      </Button>
      <p className="text-xs text-muted-foreground">
        Writes the per-department published record with the frozen policy
        version. Publishing is terminal — a published Winner stands.
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
  tally: Stage2DepartmentTally;
}) {
  const tied = tally.winnerResult.kind === "tie" ? tally.winnerResult : null;
  const published = tally.published?.published === true;
  const stagedPick =
    tally.published && !tally.published.published
      ? tally.published
      : null;
  const publishableStage = stage === "FINAL_RESULTS";
  const locked = tally.finalistsLockedAt !== null;
  const topId =
    tally.winnerResult.kind === "clean"
      ? (tally.winnerResult.winner?.finalistId ?? null)
      : null;

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
                ? "1 student vote"
                : `${tally.totalVotes} student votes`}
              {` · ${tally.finalists.length} Finalists`}
              {published ? " · Winner published" : ""}
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
              ⚠️ Tie Detected for Winner
            </p>
            <p className="mt-1 text-xs text-destructive">
              {tied.tied.length} Finalists share {tied.topVotes} votes. Resolve
              below — Ties never auto-resolve. Manually pick the department honoree.
            </p>
          </div>
        ) : null}

        {published && tally.published ? (
          <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/10 p-4">
            <div className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xs shrink-0">
              <Trophy className="size-5" />
            </div>
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-primary">
                Official Department Winner
              </span>
              <p className="text-base font-bold text-foreground">
                {tally.published.winnerFullName}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Published
                {tally.published.policyVersion === null
                  ? ""
                  : ` · policy frozen at ${tally.published.policyVersion}`}
              </p>
            </div>
          </div>
        ) : null}

        {stagedPick ? (
          <div className="flex items-center gap-3 rounded-xl border border-blue-300 bg-blue-50/60 dark:border-blue-800 dark:bg-blue-950/20 p-3.5">
            <Award className="size-5 text-blue-600 dark:text-blue-400 shrink-0" />
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300">
                Resolved Winner (Staged)
              </span>
              <p className="text-sm font-bold text-foreground">
                {stagedPick.winnerFullName}
              </p>
              <p className="text-xs text-muted-foreground">
                Awaiting publish confirmation.
              </p>
            </div>
          </div>
        ) : null}

        {tally.finalists.length === 0 ? (
          <p className="text-sm text-muted-foreground py-3 text-center">
            No frozen Finalists — freeze Stage 1 for this department first.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-3 py-1 bg-muted/40 rounded-lg">
              <span>Finalist</span>
              <span>Student Votes</span>
            </div>
            <ul className="flex flex-col gap-1.5 p-0 list-none">
              {tally.counts.map((entry, idx) => {
                const isWinner = topId === entry.finalistId;
                const isTied =
                  tied &&
                  tied.tied.some((t) => t.finalistId === entry.finalistId);

                return (
                  <li key={entry.finalistId}>
                    <div
                      className={`flex items-center justify-between p-2.5 rounded-lg border transition-colors ${
                        isWinner
                          ? "border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20"
                          : isTied
                            ? "border-destructive/40 bg-destructive/10"
                            : "border-border bg-card hover:bg-muted/30"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                            isWinner
                              ? "bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-950 dark:text-amber-300"
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
                        {isWinner && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900 border border-amber-300/60 dark:bg-amber-950 dark:text-amber-200">
                            <Trophy className="size-3" />
                            Winner
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

        {tally.ignoredVotes > 0 ? (
          <p role="alert" className="text-xs text-destructive">
            {tally.ignoredVotes} vote
            {tally.ignoredVotes === 1 ? "" : "s"} for non-Finalists excluded
            from the Winner math.
          </p>
        ) : null}

        {published ? null : tied && tally.tiePending ? (
          <div className="border-t pt-4">
            <ResolveTieForm
              electionId={electionId}
              departmentId={tally.department.id}
              tied={tied.tied}
              topVotes={tied.topVotes}
            />
          </div>
        ) : tied && publishableStage && locked ? (
          <div className="border-t pt-4">
            <FlagTieForm
              electionId={electionId}
              departmentId={tally.department.id}
              departmentCode={tally.department.code}
            />
          </div>
        ) : publishableStage && locked ? (
          <div className="border-t pt-4">
            <PublishWinnerForm
              electionId={electionId}
              departmentId={tally.department.id}
              departmentCode={tally.department.code}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {locked
              ? "Publishing opens after student voting closes."
              : "Lock this department's Finalists first — publishing needs the frozen snapshot."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function FinalResultsClient({
  electionId,
  stage,
  policyVersion,
  departments,
  totals,
}: {
  electionId: string;
  stage: string;
  policyVersion: string | null;
  departments: Stage2DepartmentTally[];
  totals: Stage2ResultsTotals;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Student voting gate</CardTitle>
          <p className="text-sm text-muted-foreground">
            Election stage: {stage} · Tie policy:{" "}
            {policyVersion === null
              ? "not frozen yet"
              : `frozen at ${policyVersion}`}
          </p>
          <p className="text-sm text-muted-foreground">
            {totals.studentVotes === 1
              ? "1 student vote"
              : `${totals.studentVotes} student votes`}
            {` · ${totals.departments} departments · ${totals.locked} with locked Finalists · ${totals.tied} tied · ${totals.published} published`}
          </p>
        </CardHeader>
        {stage === "STUDENT_VOTING" ? (
          <CardContent>
            <CloseStudentVotingForm electionId={electionId} />
          </CardContent>
        ) : null}
      </Card>

      <h2 className="mt-2 text-lg font-semibold tracking-tight">
        Winners by department
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
                      Not participating in this Election — no Stage-2 counting
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
