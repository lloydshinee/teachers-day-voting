"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import QRCode from "react-qr-code";

import { DepartmentAvatar } from "@/components/department-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { generateMissingFacultyCodes } from "@/lib/faculty/code-actions";
import type {
  DepartmentCodeStatus,
  FacultyCodeStatusTotals,
} from "@/lib/faculty/code-queries";
import type {
  FacultyCodeActionState,
  IssuedFacultyCode,
} from "@/lib/faculty/schemas";
import { buildVoteCodeLink } from "@/lib/student/vote-link";

/**
 * Client controls for faculty Code generation plus the one-time Code sheet
 * (spec §14 task 8).
 *
 * Raw Codes live only in memory here: they arrive in the generation response,
 * are shown once, and can be exported (CSV download) or printed. A refresh
 * or navigation discards them — only SHA-256 hashes are stored, so issued
 * Codes are unrecoverable afterwards. Nothing in this module logs Codes.
 */

const INITIAL_STATE: FacultyCodeActionState = {
  ok: true,
  message: "",
  electionId: "",
  issued: [],
};

function ActionMessage({ state }: { state: FacultyCodeActionState }) {
  if (!state.ok) {
    return (
      <p role="alert" className="text-sm font-medium text-destructive">
        {state.message}
      </p>
    );
  }
  if (state.message === "") {
    return null;
  }
  return (
    <p role="status" aria-live="polite" className="text-sm font-medium">
      {state.message}
    </p>
  );
}

export interface IssuedBatch {
  key: string;
  issued: IssuedFacultyCode[];
}

function GenerateForm({
  electionId,
  departmentId,
  facultyId,
  facultyName,
  label,
  pendingLabel,
  disabled,
  variant,
  onIssued,
}: {
  electionId: string;
  departmentId?: string;
  facultyId?: string;
  facultyName?: string;
  label: string;
  pendingLabel: string;
  disabled: boolean;
  variant?: "default" | "outline";
  onIssued: (batch: IssuedBatch, message: string) => void;
}) {
  const [state, formAction, isPending] = useActionState(
    generateMissingFacultyCodes,
    INITIAL_STATE,
  );
  const reportedRef = useRef<FacultyCodeActionState | null>(null);

  useEffect(() => {
    if (
      state.ok &&
      state.issued.length > 0 &&
      reportedRef.current !== state
    ) {
      reportedRef.current = state;
      onIssued(
        {
          key: `${facultyId ?? departmentId ?? "all"}-${state.issued.length}-${state.issued[0]?.code ?? ""}`,
          issued: state.issued,
        },
        state.message,
      );
    }
  }, [state, onIssued, facultyId, departmentId]);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="electionId" value={electionId} />
      {departmentId !== undefined ? (
        <input type="hidden" name="departmentId" value={departmentId} />
      ) : null}
      {facultyId !== undefined ? (
        <input type="hidden" name="facultyId" value={facultyId} />
      ) : null}
      {facultyName !== undefined ? (
        <p className="text-sm text-muted-foreground">{facultyName}</p>
      ) : null}
      {!state.ok ? <ActionMessage state={state} /> : null}
      <Button
        type="submit"
        variant={variant ?? "default"}
        disabled={disabled || isPending}
        className="h-11 w-full sm:w-auto"
      >
        {isPending ? pendingLabel : label}
      </Button>
    </form>
  );
}

function IssuedCodeSheet({
  batches,
  statuses,
  onClear,
}: {
  batches: IssuedBatch[];
  statuses: DepartmentCodeStatus[];
  onClear: () => void;
}) {
  const all = batches.flatMap((batch) => batch.issued);
  if (all.length === 0) {
    return null;
  }

  const departmentById = new Map(
    statuses.map((status) => [status.department.id, status.department] as const),
  );

  const copyCode = async (code: string, button: HTMLButtonElement) => {
    try {
      await navigator.clipboard.writeText(code);
      const original = button.textContent;
      button.textContent = "Copied";
      window.setTimeout(() => {
        button.textContent = original;
      }, 1500);
    } catch {
      button.textContent = "Copy failed";
    }
  };

  const exportCsv = () => {
    const header = "department,full_name,code";
    const lines = all.map((entry) =>
      [entry.departmentCode, `"${entry.fullName.replace(/"/g, '""')}"`, entry.code].join(","),
    );
    const blob = new Blob([[header, ...lines].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `faculty-codes-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <Card
      aria-labelledby="issued-codes-heading"
      className="border-primary print:border-0 print:bg-white print:shadow-none"
    >
      <CardHeader className="print:hidden">
        <CardTitle id="issued-codes-heading">
          New Codes — shown once ({all.length})
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Export or print now. These Codes are not stored and cannot be shown
          again — only their hashes were saved.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 print:bg-white print:p-0">
        <div className="print:hidden flex flex-col gap-2 sm:flex-row">
          <Button type="button" onClick={exportCsv} className="h-11 flex-1">
            Export CSV
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => window.print()}
            className="h-11 flex-1"
          >
            Print code sheet
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onClear}
            className="h-11 flex-1"
          >
            Dismiss
          </Button>
        </div>
        <div className="code-sheet">
          <h2 className="hidden text-xl font-bold print:block">
            Teachers&apos; Day Voting — faculty voting Codes, distribute once
            then destroy this sheet
          </h2>
          <ul className="code-sheet-list">
            {all.map((entry) => {
              const department = departmentById.get(entry.departmentId);
              const departmentLabel =
                department !== undefined
                  ? `${department.code} · ${department.name}`
                  : entry.departmentCode;
              return (
                <li key={entry.facultyId} className="code-slip">
                  <p className="code-slip-event">Teachers&apos; Day Voting</p>
                  <p className="code-slip-kind">Faculty voting Code</p>
                  <p className="code-slip-department">{departmentLabel}</p>
                  <p className="code-slip-holder">{entry.fullName}</p>
                  <span
                    className="code-slip-qr"
                    role="img"
                    aria-label={`QR for Code ${entry.code}`}
                  >
                    <QRCode
                      value={buildVoteCodeLink(entry.code)}
                      size={96}
                      title={`Vote link QR for ${entry.code}`}
                    />
                  </span>
                  <p className="code-slip-code">{entry.code}</p>
                  <p className="code-slip-rule">
                    One Code, one vote — do not share. This Code stops
                    working after one vote.
                  </p>
                  <button
                    type="button"
                    className="code-slip-copy print:hidden"
                    onClick={(event) =>
                      void copyCode(entry.code, event.currentTarget)
                    }
                  >
                    Copy
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

export function FacultyCodesClient({
  electionId,
  statuses,
  totals,
}: {
  electionId: string;
  statuses: DepartmentCodeStatus[];
  totals: FacultyCodeStatusTotals;
}) {
  const [batches, setBatches] = useState<IssuedBatch[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const handleIssued = (batch: IssuedBatch, message: string) => {
    setBatches((previous) => [...previous, batch]);
    setNotices((previous) => [...previous, message]);
  };

  const filteredStatuses = statuses.filter(
    (s) =>
      s.department.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.department.code.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-4">
      <IssuedCodeSheet
        batches={batches}
        statuses={statuses}
        onClear={() => {
          setBatches([]);
        }}
      />
      {notices.length > 0 ? (
        <div className="print:hidden" role="status" aria-live="polite">
          {notices.map((notice, index) => (
            <p key={index} className="text-sm font-medium">
              {notice}
            </p>
          ))}
        </div>
      ) : null}

      <div className="print:hidden flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Generate missing Codes</CardTitle>
            <p className="text-sm text-muted-foreground">
              Creates exactly the shortfall ({totals.missing} missing): every
              eligible faculty member without a live voting Token gets one
              Code. Faculty who already voted keep their used Token and get no
              second Code.
            </p>
          </CardHeader>
          <CardContent>
            <GenerateForm
              electionId={electionId}
              label={
                totals.missing === 0
                  ? "No missing Codes"
                  : `Generate all ${totals.missing} missing Code${totals.missing === 1 ? "" : "s"}`
              }
              pendingLabel="Generating…"
              disabled={totals.missing === 0}
              onIssued={handleIssued}
            />
          </CardContent>
        </Card>

        <div className="mt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            Code status by department ({statuses.length})
          </h2>
          {statuses.length > 2 && (
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                type="search"
                placeholder="Search department…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </div>
          )}
        </div>

        {filteredStatuses.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No departments match &quot;{searchQuery}&quot;.
          </p>
        ) : (
          <ul className="flex list-none flex-col gap-4 p-0">
            {filteredStatuses.map((status) => (
              <li key={status.department.id}>
                <Card className="shadow-xs overflow-hidden">
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <DepartmentAvatar
                        name={status.department.name}
                        code={status.department.code}
                        size="sm"
                      />
                      <div>
                        <CardTitle>
                          {status.department.code} · {status.department.name}
                        </CardTitle>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {status.participating
                            ? `${status.eligibleCount} eligible · ${status.liveUnused} live unused · ${status.used} used · ${status.invalidated} invalidated · ${status.missingCount} missing`
                            : "Not participating in this Election — no Codes issued here."}
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                {status.participating ? (
                  <CardContent className="flex flex-col gap-4">
                    <GenerateForm
                      electionId={electionId}
                      departmentId={status.department.id}
                      label={
                        status.missingCount === 0
                          ? "No missing Codes in this department"
                          : `Generate ${status.missingCount} missing Code${status.missingCount === 1 ? "" : "s"}`
                      }
                      pendingLabel="Generating…"
                      disabled={status.missingCount === 0}
                      variant="outline"
                      onIssued={handleIssued}
                    />
                    {status.missing.length > 0 ? (
                      <div className="border-t pt-4">
                        <h3 className="text-sm font-semibold tracking-tight">
                          Missing Codes ({status.missing.length})
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          One-click generation for newcomers — issues exactly
                          one Code, never duplicates.
                        </p>
                        <ul className="mt-2 flex list-none flex-col gap-3 p-0">
                          {status.missing.map((member) => (
                            <li
                              key={member.id}
                              className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <span className="text-sm font-medium">
                                {member.fullName}
                              </span>
                              <GenerateForm
                                electionId={electionId}
                                departmentId={status.department.id}
                                facultyId={member.id}
                                label={`Generate Code for ${member.fullName}`}
                                pendingLabel="Generating…"
                                disabled={false}
                                variant="outline"
                                onIssued={handleIssued}
                              />
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </CardContent>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
        )}
      </div>
    </div>
  );
}
