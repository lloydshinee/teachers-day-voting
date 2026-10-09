"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { resolveStage1Tie } from "@/lib/stage1/actions";
import type { Stage1ActionState } from "@/lib/stage1/schemas";
import { publishStage2Winner, resolveStage2Tie } from "@/lib/stage2/actions";
import type { Stage2ActionState } from "@/lib/stage2/schemas";

const INITIAL_STAGE1_STATE: Stage1ActionState = { ok: true, message: "" };
const INITIAL_STAGE2_STATE: Stage2ActionState = { ok: true, message: "" };

export function DrilldownResolveStage1TieForm({
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
    INITIAL_STAGE1_STATE,
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
    <form action={formAction} className="mt-3 flex flex-col gap-3">
      <input type="hidden" name="electionId" value={electionId} />
      <input type="hidden" name="departmentId" value={departmentId} />
      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-semibold tracking-tight text-destructive">
          Pick exactly {seatsRemaining} of the {tied.length} tied Candidates ({cutoffVotes} votes each):
        </legend>
        <ul className="flex list-none flex-col gap-1.5 p-0">
          {tied.map((entry) => (
            <li key={entry.candidateId}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-destructive/30 bg-background p-2.5 text-xs font-medium has-checked:border-primary">
                <input
                  type="checkbox"
                  name="pickedCandidateIds"
                  value={entry.candidateId}
                  checked={checked.has(entry.candidateId)}
                  onChange={() => toggle(entry.candidateId)}
                  className="h-4 w-4 accent-primary"
                />
                <span>
                  {entry.fullName}
                  <span className="ml-1.5 text-muted-foreground">
                    ({entry.votes} vote{entry.votes === 1 ? "" : "s"})
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      {!state.ok ? (
        <p role="alert" className="text-xs font-medium text-destructive">
          {state.message}
        </p>
      ) : state.message ? (
        <p role="status" className="text-xs font-medium text-emerald-600">
          {state.message}
        </p>
      ) : null}
      <Button
        type="submit"
        disabled={isPending || checked.size !== seatsRemaining}
        className="h-9 w-full sm:w-auto text-xs font-semibold"
      >
        {isPending
          ? "Resolving…"
          : `Resolve Tie — advance ${seatsRemaining} Candidate${seatsRemaining === 1 ? "" : "s"}`}
      </Button>
    </form>
  );
}

export function DrilldownResolveStage2TieForm({
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
    INITIAL_STAGE2_STATE,
  );
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-3">
      <input type="hidden" name="electionId" value={electionId} />
      <input type="hidden" name="departmentId" value={departmentId} />
      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-semibold tracking-tight text-destructive">
          Pick exactly one of the {tied.length} tied Finalists ({topVotes} votes each):
        </legend>
        <ul className="flex list-none flex-col gap-1.5 p-0">
          {tied.map((entry) => (
            <li key={entry.finalistId}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-destructive/30 bg-background p-2.5 text-xs font-medium has-checked:border-primary">
                <input
                  type="radio"
                  name="pickedFinalistId"
                  value={entry.finalistId}
                  checked={picked === entry.finalistId}
                  onChange={() => setPicked(entry.finalistId)}
                  className="h-4 w-4 accent-primary"
                />
                <span>
                  {entry.fullName}
                  <span className="ml-1.5 text-muted-foreground">
                    ({entry.votes} vote{entry.votes === 1 ? "" : "s"})
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      {!state.ok ? (
        <p role="alert" className="text-xs font-medium text-destructive">
          {state.message}
        </p>
      ) : state.message ? (
        <p role="status" className="text-xs font-medium text-emerald-600">
          {state.message}
        </p>
      ) : null}
      <Button
        type="submit"
        disabled={isPending || picked === null}
        className="h-9 w-full sm:w-auto text-xs font-semibold"
      >
        {isPending ? "Resolving…" : "Resolve Tie — pick Winner"}
      </Button>
    </form>
  );
}

export function DrilldownPublishControl({
  electionId,
  departmentId,
  departmentCode,
  canPublish,
  disabledReason,
}: {
  electionId: string;
  departmentId: string;
  departmentCode: string;
  canPublish: boolean;
  disabledReason?: string;
}) {
  const [state, formAction, isPending] = useActionState(
    publishStage2Winner,
    INITIAL_STAGE2_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col gap-2 rounded-xl border border-border/80 bg-card p-4">
      <input type="hidden" name="electionId" value={electionId} />
      <input type="hidden" name="departmentId" value={departmentId} />
      <div>
        <h4 className="text-sm font-semibold text-foreground">
          Publish Department Winner ({departmentCode})
        </h4>
        <p className="text-xs text-muted-foreground mt-0.5">
          {disabledReason ||
            "Publishes the department honoree to the public results page with the frozen policy version."}
        </p>
      </div>
      {!state.ok ? (
        <p role="alert" className="text-xs font-medium text-destructive">
          {state.message}
        </p>
      ) : state.message ? (
        <p role="status" className="text-xs font-medium text-emerald-600">
          {state.message}
        </p>
      ) : null}
      <Button
        type="submit"
        disabled={isPending || !canPublish}
        className="h-9 w-full sm:w-auto text-xs font-semibold"
      >
        {isPending ? "Publishing…" : `Publish Winner (${departmentCode})`}
      </Button>
    </form>
  );
}
