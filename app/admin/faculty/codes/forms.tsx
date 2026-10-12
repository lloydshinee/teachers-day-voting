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
  const [selectedDept, setSelectedDept] = useState<string>("ALL");
  const all = batches.flatMap((batch) => batch.issued);
  if (all.length === 0) {
    return null;
  }

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

  const downloadCsv = (entries: IssuedFacultyCode[], filename: string) => {
    const header = "department,full_name,code";
    const lines = entries.map((entry) =>
      [entry.departmentCode, `"${entry.fullName.replace(/"/g, '""')}"`, entry.code].join(","),
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
      downloadCsv(all, `faculty-codes-ALL-${dateStr}.csv`);
    } else {
      const deptEntries = all.filter((e) => e.departmentCode === selectedDept);
      downloadCsv(deptEntries, `faculty-codes-${selectedDept}-${dateStr}.csv`);
    }
  };

  const exportSeparateCsvs = () => {
    const dateStr = new Date().toISOString().slice(0, 10);
    departmentsInBatch.forEach((code, index) => {
      const deptEntries = all.filter((e) => e.departmentCode === code);
      // Small staggered delay so browsers allow multiple simultaneous downloads
      window.setTimeout(() => {
        downloadCsv(deptEntries, `faculty-codes-${code}-${dateStr}.csv`);
      }, index * 200);
    });
  };

  const renderSlip = (entry: IssuedFacultyCode) => {
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
            size={72}
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
            void copyCode(entry.code, event.currentTarget)
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
          again — only their hashes were saved.
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
        <div className="code-sheet code-sheet-faculty">
          <h2 className="hidden text-xl font-bold print:block mb-3">
            Teachers&apos; Day Voting — Faculty Voting Codes
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
                      {deptEntries.length} faculty slips
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
                  {displayedEntries.length} faculty slips
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
