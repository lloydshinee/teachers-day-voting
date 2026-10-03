import type { Metadata } from "next";

import { listFacultyByDepartment } from "@/lib/faculty/queries";

import { FacultyManager } from "./forms";

export const metadata: Metadata = {
  title: "Faculty · Admin",
  description: "Admin management of faculty Candidates.",
};

export default async function AdminFacultyPage() {
  const result = await listFacultyByDepartment();

  if (!result.ok) {
    const isDenied =
      result.code === "UNAUTHENTICATED" || result.code === "FORBIDDEN";
    return (
      <section aria-labelledby="faculty-heading" className="flex flex-col gap-4">
        <div>
          <h1 id="faculty-heading" className="text-2xl font-bold tracking-tight">
            Faculty Roster
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Add, edit, archive, and move faculty members between departments.
          </p>
        </div>
        <p role="alert" className="text-sm font-medium text-destructive">
          {isDenied ? result.message : "Could not load faculty. Try again."}
        </p>
      </section>
    );
  }

  const departments = result.groups.map((group) => group.department);

  return (
    <section aria-labelledby="faculty-heading" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2.5">
          <h1 id="faculty-heading" className="text-2xl font-bold tracking-tight">
            Faculty Roster
          </h1>
          <span className="rounded-full bg-primary/10 border border-primary/20 px-2.5 py-0.5 text-xs font-bold text-primary">
            {result.totalEligible} Eligible
          </span>
          {result.totalArchived > 0 ? (
            <span className="rounded-full bg-muted border border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              {result.totalArchived} Archived
            </span>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Official directory of faculty candidates eligible for peer nomination.
        </p>
      </div>

      <FacultyManager
        groups={result.groups}
        departments={departments}
        totalEligible={result.totalEligible}
        totalArchived={result.totalArchived}
      />
    </section>
  );
}
