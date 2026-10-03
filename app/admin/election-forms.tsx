"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { DepartmentAvatar } from "@/components/department-avatar";
import { Modal } from "@/components/ui/modal";
import {
  advanceElectionStage,
  createElection,
  type LifecycleActionState,
} from "@/lib/election/lifecycle-actions";
import type { ElectionStage } from "@/lib/election/stages";

interface DepartmentOption {
  id: string;
  code: string;
  name: string;
  picture_url?: string | null;
}

const STAGE_METADATA: Record<
  ElectionStage,
  {
    label: string;
    nextAction?: {
      action: string;
      buttonText: string;
      confirmPrompt: string;
      description: string;
    };
    description: string;
    badgeClass: string;
  }
> = {
  DRAFT: {
    label: "Draft",
    nextAction: {
      action: "OPEN_FACULTY_VOTING",
      buttonText: "Open Faculty Voting",
      confirmPrompt:
        "Are you sure you want to open Faculty Voting? This will lock the tie-breaking policy and allow faculty with codes to cast votes.",
      description: "When faculty codes are generated and ready, open voting.",
    },
    description: "Election is in draft mode. Faculty codes can be generated.",
    badgeClass: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950 dark:text-amber-300",
  },
  FACULTY_VOTING: {
    label: "Faculty Voting Open",
    nextAction: {
      action: "CLOSE_FACULTY_VOTING",
      buttonText: "Close Faculty Voting",
      confirmPrompt:
        "Are you sure you want to close Faculty Voting? No further faculty peer votes will be accepted.",
      description: "Voting in progress. When the deadline passes, close stage 1.",
    },
    description: "Faculty peer voting is active at /vote. Results remain hidden until closed.",
    badgeClass: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300",
  },
  FACULTY_RESULTS: {
    label: "Faculty Results (Stage 1)",
    nextAction: {
      action: "OPEN_STUDENT_VOTING",
      buttonText: "Open Student Voting",
      confirmPrompt:
        "Are you sure you want to open Student Voting? Ensure finalists have been locked in Faculty Results first.",
      description: "Finalists can now be locked. When ready, advance to student voting.",
    },
    description: "Stage 1 voting is closed. Review tallies, resolve any ties, and freeze Top-3 Finalists.",
    badgeClass: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950 dark:text-blue-300",
  },
  STUDENT_VOTING: {
    label: "Student Voting Open",
    nextAction: {
      action: "CLOSE_STUDENT_VOTING",
      buttonText: "Close Student Voting",
      confirmPrompt:
        "Are you sure you want to close Student Voting? No further student votes will be accepted.",
      description: "Students are casting votes. When the voting window ends, close stage 2.",
    },
    description: "Students are voting for their department honoree at /vote.",
    badgeClass: "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950 dark:text-purple-300",
  },
  FINAL_RESULTS: {
    label: "Final Results (Stage 2)",
    nextAction: {
      action: "CLOSE_ELECTION",
      buttonText: "Close Election",
      confirmPrompt:
        "Are you sure you want to close this election? Once closed, no further edits or votes can be made.",
      description: "Publish department winners in Final Results before closing.",
    },
    description: "Student voting is closed. Resolve any ties and publish the Winners.",
    badgeClass: "bg-indigo-100 text-indigo-800 border-indigo-300 dark:bg-indigo-950 dark:text-indigo-300",
  },
  CLOSED: {
    label: "Election Closed",
    description: "This election is finalized. Published winners are visible to the public.",
    badgeClass: "bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-900 dark:text-slate-300",
  },
};

const STAGE_ORDER: ElectionStage[] = [
  "DRAFT",
  "FACULTY_VOTING",
  "FACULTY_RESULTS",
  "STUDENT_VOTING",
  "FINAL_RESULTS",
  "CLOSED",
];

export function CreateElectionModal({
  departments,
  open,
  onOpenChange,
}: {
  departments: DepartmentOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<LifecycleActionState, FormData>(
    createElection,
    { ok: true },
  );

  const [selectedDepts, setSelectedDepts] = useState<string[]>(
    departments.map((d) => d.id),
  );

  useEffect(() => {
    if (state.ok && state.electionId) {
      onOpenChange(false);
      router.push(`/admin?election=${encodeURIComponent(state.electionId)}`);
      router.refresh();
    }
  }, [state, onOpenChange, router]);

  const toggleDept = (id: string) => {
    setSelectedDepts((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const toggleAll = () => {
    if (selectedDepts.length === departments.length) {
      setSelectedDepts([]);
    } else {
      setSelectedDepts(departments.map((d) => d.id));
    }
  };

  const currentYear = new Date().getFullYear();
  const defaultYear = `${currentYear}-${currentYear + 1}`;

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Create New Election">
      <form action={formAction} className="flex flex-col gap-4">
        {state.message && !state.ok && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {state.message}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="election-name" className="text-sm font-medium">
            Election Name <span className="text-destructive">*</span>
          </label>
          <input
            id="election-name"
            name="name"
            type="text"
            required
            defaultValue={`Teachers' Day ${currentYear}`}
            placeholder="e.g. Teachers' Day 2026"
            className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="academic-year" className="text-sm font-medium">
            Academic Year <span className="text-destructive">*</span>
          </label>
          <input
            id="academic-year"
            name="academicYear"
            type="text"
            required
            defaultValue={defaultYear}
            placeholder="e.g. 2026-2027"
            className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="tie-policy" className="text-sm font-medium">
            Tie-Breaking Policy
          </label>
          <textarea
            id="tie-policy"
            name="tiePolicyText"
            rows={2}
            defaultValue="Manual admin pick from tied candidates at both stages (Top-3 cutoff and winner)"
            className="rounded-lg border border-input bg-background p-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <p className="text-xs text-muted-foreground">
            This policy will freeze permanently once Faculty Voting is opened.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Participating Departments</span>
            {departments.length > 0 && (
              <button
                type="button"
                onClick={toggleAll}
                className="text-xs font-semibold text-primary hover:underline"
              >
                {selectedDepts.length === departments.length
                  ? "Deselect All"
                  : "Select All"}
              </button>
            )}
          </div>

          {departments.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No departments found. All existing departments will be included.
            </p>
          ) : (
            <div className="max-h-40 overflow-y-auto rounded-lg border p-2 flex flex-col gap-1.5 bg-muted/20">
              {departments.map((dept) => {
                const isSelected = selectedDepts.includes(dept.id);
                return (
                  <label
                    key={dept.id}
                    className="flex items-center gap-2 rounded p-1.5 hover:bg-muted cursor-pointer transition-colors text-sm"
                  >
                    <input
                      type="checkbox"
                      name="departmentIds"
                      value={dept.id}
                      checked={isSelected}
                      onChange={() => toggleDept(dept.id)}
                      className="rounded border-input text-primary focus:ring-primary h-4 w-4"
                    />
                    <DepartmentAvatar
                      name={dept.name}
                      code={dept.code}
                      url={dept.picture_url}
                      size="sm"
                    />
                    <span className="font-semibold text-xs">{dept.code}</span>
                    <span className="text-xs text-muted-foreground truncate">
                      {dept.name}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-2 flex justify-end gap-2 border-t pt-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            className="h-10 rounded-lg border border-input bg-background px-4 text-sm font-medium text-foreground hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="h-10 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? "Creating..." : "Create Election"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function CreateElectionButton({
  departments,
  variant = "secondary",
  className = "",
  label = "+ New Election",
}: {
  departments: DepartmentOption[];
  variant?: "primary" | "secondary";
  className?: string;
  label?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={
          className ||
          (variant === "primary"
            ? "inline-flex h-11 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 shadow-sm"
            : "inline-flex h-11 items-center justify-center rounded-lg bg-secondary px-4 text-sm font-medium text-secondary-foreground hover:bg-secondary/80")
        }
      >
        {label}
      </button>

      <CreateElectionModal
        departments={departments}
        open={isOpen}
        onOpenChange={setIsOpen}
      />
    </>
  );
}

export function ElectionStageControls({
  electionId,
  stage,
}: {
  electionId: string;
  stage: ElectionStage;
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<LifecycleActionState, FormData>(
    advanceElectionStage,
    { ok: true },
  );

  useEffect(() => {
    if (state.ok && state.message) {
      router.refresh();
    }
  }, [state, router]);

  const meta = STAGE_METADATA[stage] ?? STAGE_METADATA.DRAFT;
  const currentIndex = STAGE_ORDER.indexOf(stage);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    if (meta.nextAction?.confirmPrompt) {
      if (!window.confirm(meta.nextAction.confirmPrompt)) {
        e.preventDefault();
      }
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-xs sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Election Status
            </span>
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${meta.badgeClass}`}
            >
              {meta.label}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{meta.description}</p>
        </div>

        {meta.nextAction && (
          <form action={formAction} onSubmit={handleSubmit} className="shrink-0">
            <input type="hidden" name="electionId" value={electionId} />
            <input type="hidden" name="action" value={meta.nextAction.action} />
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex h-10 w-full sm:w-auto items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 shadow-sm transition-colors disabled:opacity-50"
            >
              {isPending ? "Updating Stage..." : meta.nextAction.buttonText}
            </button>
          </form>
        )}
      </div>

      {state.message && (
        <div
          role="status"
          className={`rounded-lg border p-3 text-sm ${
            state.ok
              ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
              : "border-destructive/30 bg-destructive/10 text-destructive"
          }`}
        >
          {state.message}
        </div>
      )}

      {/* Visual Pipeline Progression */}
      <div className="pt-2 border-t">
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-xs">
          {STAGE_ORDER.map((s, idx) => {
            const isCompleted = idx < currentIndex;
            const isCurrent = idx === currentIndex;
            return (
              <div
                key={s}
                className={`flex flex-col p-2 rounded-lg border text-center transition-all ${
                  isCurrent
                    ? "border-primary bg-primary/10 font-bold text-primary shadow-xs"
                    : isCompleted
                      ? "border-muted bg-muted/40 text-muted-foreground"
                      : "border-dashed border-muted text-muted-foreground/50 opacity-60"
                }`}
              >
                <span className="text-[10px] text-muted-foreground">Step {idx + 1}</span>
                <span className="truncate">{STAGE_METADATA[s].label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
