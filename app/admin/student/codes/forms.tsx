"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import QRCode from "react-qr-code";

import { DepartmentAvatar } from "@/components/department-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { generateStudentCodes } from "@/lib/student/code-actions";
import type {
  DepartmentStudentCodeStatus,
  StudentCodeStatusTotals,
} from "@/lib/student/code-queries";
import {
  MAX_STUDENT_CODES_PER_CALL,
  type IssuedStudentCode,
  type StudentCodeActionState,
} from "@/lib/student/schemas";
import { buildVoteCodeLink } from "@/lib/student/vote-link";

/**
 * Client controls for student Code generation plus the one-time Code sheet
 * with QR (spec §14 task 11).
 *
 * Raw Codes live only in memory here: they arrive in the generation
 * response, are shown once with their QR (`/vote?token=<CODE>` and nothing
 * else), and can be exported (CSV download) or printed. A refresh or
 * navigation discards them — only SHA-256 hashes are stored, so issued
 * Codes are unrecoverable afterwards. Nothing in this module logs Codes.
 */

const INITIAL_STATE: StudentCodeActionState = {
  ok: false,
  code: "INVALID_INPUT",
  message: "",
};

function ActionMessage({ state }: { state: StudentCodeActionState }) {
  if (state.ok) {
    return null;
  }
  if (state.message === "") {
    return null;
  }
  return (
    <p role="alert" className="text-sm font-medium text-destructive">
      {state.message}
    </p>
  );
}

export interface IssuedBatch {
  key: string;
  issued: IssuedStudentCode[];
}

function GenerateForm({
  electionId,
  departmentId,
  disabled,
  onIssued,
}: {
  electionId: string;
  departmentId: string;
  disabled: boolean;
  onIssued: (batch: IssuedBatch, message: string) => void;
}) {
  const [state, formAction, isPending] = useActionState(
    generateStudentCodes,
    INITIAL_STATE,
  );
  const reportedRef = useRef<StudentCodeActionState | null>(null);

  useEffect(() => {
    if (state.ok && state.issued.length > 0 && reportedRef.current !== state) {
      reportedRef.current = state;
      onIssued(
        {
          key: `${state.departmentId}-${state.issued.length}-${state.issued[0]?.code ?? ""}`,
          issued: state.issued,
        },
        state.message,
      );
    }
  }, [state, onIssued]);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="electionId" value={electionId} />
      <input type="hidden" name="departmentId" value={departmentId} />
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`quantity-${departmentId}`}
          className="text-sm font-medium leading-none"
        >
          Quantity
        </label>
        <input
          id={`quantity-${departmentId}`}
          name="quantity"
          type="number"
          min={1}
          max={MAX_STUDENT_CODES_PER_CALL}
          step={1}
          required
          defaultValue={30}
          disabled={disabled || isPending}
          className="h-11 w-full rounded-lg border border-input bg-background px-3 py-1 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm sm:max-w-40"
        />
      </div>
      {!state.ok ? <ActionMessage state={state} /> : null}
      <Button
        type="submit"
        variant="outline"
        disabled={disabled || isPending}
        className="h-11 w-full sm:w-auto"
      >
        {isPending ? "Generating…" : "Generate more Codes"}
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
  statuses: DepartmentStudentCodeStatus[];
  onClear: () => void;
}) {
  const [selectedDept, setSelectedDept] = useState<string>("ALL");
  const all = batches.flatMap((batch) => batch.issued);
  if (all.length === 0) {
    return null;
  }

  const copyCode = (code: string, button: HTMLButtonElement) => {
    const done = (label: string) => {
      const original = button.textContent;
      button.textContent = label;
      window.setTimeout(() => {
        button.textContent = original;
      }, 1500);
    };
    const clipboard = navigator.clipboard;
    if (!clipboard) {
      done("Copy unavailable");
      return;
    }
    void clipboard
      .writeText(code)
      .then(() => done("Copied"))
      .catch(() => done("Copy failed"));
  };

  const departmentById = new Map(
    statuses.map((status) => [status.department.id, status.department] as const),
  );

  const departmentsInBatch = Array.from(
    new Set(all.map((entry) => entry.departmentCode)),
  ).sort();

  const displayedEntries =
    selectedDept === "ALL"
      ? all
      : all.filter((entry) => entry.departmentCode === selectedDept);

  const downloadCsv = (entries: IssuedStudentCode[], filename: string) => {
    const header = "department,code,vote_link";
    const lines = entries.map((entry) =>
      [entry.departmentCode, entry.code, buildVoteCodeLink(entry.code)].join(","),
    );
    const blob = new Blob([[header, ...lines].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const exportCurrentCsv = () => {
    const dateStr = new Date().toISOString().slice(0, 10);
    if (selectedDept === "ALL") {
      downloadCsv(all, `student-codes-ALL-${dateStr}.csv`);
    } else {
      const deptEntries = all.filter((e) => e.departmentCode === selectedDept);
      downloadCsv(deptEntries, `student-codes-${selectedDept}-${dateStr}.csv`);
    }
  };

  const exportSeparateCsvs = () => {
    const dateStr = new Date().toISOString().slice(0, 10);
    departmentsInBatch.forEach((code, index) => {
      const deptEntries = all.filter((e) => e.departmentCode === code);
      window.setTimeout(() => {
        downloadCsv(deptEntries, `student-codes-${code}-${dateStr}.csv`);
      }, index * 200);
    });
  };

  const renderSlip = (entry: IssuedStudentCode) => {
    const department = departmentById.get(entry.departmentId);
    const departmentLabel =
      department !== undefined
        ? `${department.code} · ${department.name}`
        : entry.departmentCode;

    return (
      <li key={entry.code} className="code-slip">
        <p className="code-slip-event">Teachers&apos; Day Voting</p>
        <p className="code-slip-kind">Student voting Code</p>
        <p className="code-slip-department">{departmentLabel}</p>
        <span
          className="code-slip-qr"
          role="img"
          aria-label={`QR for Code ${entry.code}`}
        >
          <QRCode
            value={buildVoteCodeLink(entry.code)}
            size={64}
            title={`Vote link QR for ${entry.code}`}
          />
        </span>
        <p className="code-slip-code">{entry.code}</p>
        <p className="code-slip-rule">
          Single-use code • 1 vote only.
        </p>
        <button
          type="button"
          className="code-slip-copy print:hidden"
          onClick={(event) =>
            copyCode(entry.code, event.currentTarget)
          }
        >
          Copy
        </button>
      </li>
    );
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
          again — only their hashes were saved. Each QR encodes only the vote
          link for its Code.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 print:bg-white print:p-0">
        {/* Department Filter Controls */}
        <div className="print:hidden flex flex-col gap-2 rounded-lg border bg-muted/40 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Department Filter (Print & Export)
            </span>
            <span className="text-xs text-muted-foreground">
              Showing {displayedEntries.length} of {all.length} slips
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              size="sm"
              variant={selectedDept === "ALL" ? "default" : "outline"}
              onClick={() => setSelectedDept("ALL")}
              className="h-8 text-xs font-medium"
            >
              All Departments ({all.length})
            </Button>
            {departmentsInBatch.map((code) => {
              const count = all.filter((e) => e.departmentCode === code).length;
              return (
                <Button
                  key={code}
                  type="button"
                  size="sm"
                  variant={selectedDept === code ? "default" : "outline"}
                  onClick={() => setSelectedDept(code)}
                  className="h-8 text-xs font-medium"
                >
                  {code} ({count})
                </Button>
              );
            })}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="print:hidden flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={exportCurrentCsv}
            className="h-10 flex-1 min-w-[140px]"
          >
            Export CSV ({selectedDept === "ALL" ? "Combined" : selectedDept})
          </Button>

          {departmentsInBatch.length > 1 && (
            <Button
              type="button"
              variant="secondary"
              onClick={exportSeparateCsvs}
              className="h-10 flex-1 min-w-[180px]"
              title="Download separate CSV files for each department"
            >
              Export Separate CSVs ({departmentsInBatch.length} files)
            </Button>
          )}

          <Button
            type="button"
            variant="outline"
            onClick={() => window.print()}
            className="h-10 flex-1 min-w-[140px]"
          >
            Print {selectedDept === "ALL" ? "All Departments" : `${selectedDept} Only`}
          </Button>

          <Button
            type="button"
            variant="ghost"
            onClick={onClear}
            className="h-10 min-w-[90px]"
          >
            Dismiss
          </Button>
        </div>

        {/* Code Sheets with per-department page breaks */}
        <div className="code-sheet code-sheet-student">
          <h2 className="hidden text-xl font-bold print:block mb-3">
            Teachers&apos; Day Voting — Student Voting Codes
          </h2>

          {selectedDept === "ALL" ? (
            departmentsInBatch.map((deptCode) => {
              const deptEntries = all.filter((e) => e.departmentCode === deptCode);
              const dept = statuses.find((s) => s.department.code === deptCode)?.department;
              const deptTitle = dept ? `${dept.code} · ${dept.name}` : deptCode;

              return (
                <section
                  key={deptCode}
                  className="code-sheet-department-section mb-6 print:mb-0 print:break-after-page"
                >
                  <div className="code-sheet-dept-header mb-2.5 pb-1 border-b-2 border-border print:border-black flex items-baseline justify-between">
                    <h3 className="text-base font-bold text-foreground print:text-black">
                      {deptTitle}
                    </h3>
                    <span className="text-xs text-muted-foreground print:text-black font-medium">
                      {deptEntries.length} student slips
                    </span>
                  </div>
                  <ul className="code-sheet-list">
                    {deptEntries.map((entry) => renderSlip(entry))}
                  </ul>
                </section>
              );
            })
          ) : (
            <section className="code-sheet-department-section">
              <div className="code-sheet-dept-header mb-2.5 pb-1 border-b-2 border-border print:border-black flex items-baseline justify-between">
                <h3 className="text-base font-bold text-foreground print:text-black">
                  {statuses.find((s) => s.department.code === selectedDept)?.department.name ?? selectedDept} ({selectedDept})
                </h3>
                <span className="text-xs text-muted-foreground print:text-black font-medium">
                  {displayedEntries.length} student slips
                </span>
              </div>
              <ul className="code-sheet-list">
                {displayedEntries.map((entry) => renderSlip(entry))}
              </ul>
            </section>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function StudentCodesClient({
  electionId,
  statuses,
  totals,
}: {
  electionId: string;
  statuses: DepartmentStudentCodeStatus[];
  totals: StudentCodeStatusTotals;
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
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              Code status by department ({statuses.length})
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {totals.generated === 1
                ? "1 Code generated"
                : `${totals.generated} Codes generated`}
              {` · ${totals.used} used · ${totals.remaining} remaining`}
              {totals.invalidated > 0
                ? ` · ${totals.invalidated} invalidated`
                : ""}
            </p>
          </div>
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
                            ? `${status.generated} generated · ${status.used} used · ${status.remaining} remaining` +
                              (status.invalidated > 0
                                ? ` · ${status.invalidated} invalidated`
                                : "")
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
                      disabled={false}
                      onIssued={handleIssued}
                    />
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
