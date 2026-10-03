import type { Metadata } from "next";

import { listDepartmentsWithCounts } from "@/lib/departments/queries";

import { DepartmentsManager } from "./forms";

export const metadata: Metadata = {
  title: "Departments · Admin",
  description: "Admin management of voting departments.",
};

export default async function AdminDepartmentsPage() {
  const result = await listDepartmentsWithCounts();

  if (!result.ok) {
    const isDenied =
      result.code === "UNAUTHENTICATED" || result.code === "FORBIDDEN";
    return (
      <section aria-labelledby="departments-heading" className="flex flex-col gap-4">
        <div>
          <h1 id="departments-heading" className="text-2xl font-bold tracking-tight">
            Departments
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create, rename, and remove voting departments.
          </p>
        </div>
        <p role="alert" className="text-sm font-medium text-destructive">
          {isDenied ? result.message : "Could not load departments. Try again."}
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="departments-heading" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2.5">
          <h1 id="departments-heading" className="text-2xl font-bold tracking-tight">
            Departments
          </h1>
          <span className="rounded-full bg-primary/10 border border-primary/20 px-2.5 py-0.5 text-xs font-bold text-primary">
            {result.departments.length}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Manage voting colleges, emblems, and department configuration.
        </p>
      </div>

      <DepartmentsManager departments={result.departments} />
    </section>
  );
}
