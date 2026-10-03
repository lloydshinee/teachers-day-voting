"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import {
  ExternalLink,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";

import { DepartmentAvatar } from "@/components/department-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import {
  createDepartment,
  deleteDepartment,
  renameDepartment,
} from "@/lib/departments/actions";
import type {
  DepartmentActionState,
  DepartmentWithFacultyCount,
} from "@/lib/departments/schemas";

const INITIAL_STATE: DepartmentActionState = { ok: true, message: "" };

function ActionMessage({ state }: { state: DepartmentActionState }) {
  if (state.message === "") {
    return null;
  }
  return (
    <div
      role={state.ok ? "status" : "alert"}
      aria-live="polite"
      className={`rounded-xl p-3 text-xs font-semibold ${
        state.ok
          ? "border border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "border border-destructive/20 bg-destructive/10 text-destructive"
      }`}
    >
      {state.message}
    </div>
  );
}

export function CreateDepartmentModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, formAction, isPending] = useActionState(
    createDepartment,
    INITIAL_STATE,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const codeId = useId();
  const nameId = useId();
  const pictureId = useId();

  const wasSuccessful = state.ok && state.message !== "";
  useEffect(() => {
    if (wasSuccessful) {
      formRef.current?.reset();
      const timer = setTimeout(() => {
        onOpenChange(false);
      }, 700);
      return () => clearTimeout(timer);
    }
  }, [wasSuccessful, onOpenChange]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Add New Department"
      description="Create a voting college or academic department."
      maxWidth="md"
    >
      <form ref={formRef} action={formAction} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={codeId}>Department Code</Label>
          <Input
            id={codeId}
            name="code"
            required
            minLength={2}
            maxLength={10}
            autoComplete="off"
            placeholder="CCS"
            className="uppercase font-semibold tracking-wider"
          />
          <p className="text-[11px] text-muted-foreground">
            Unique short abbreviation (e.g. CCS, COE, CAS). Stored uppercase.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={nameId}>Department Name</Label>
          <Input
            id={nameId}
            name="name"
            required
            maxLength={120}
            autoComplete="off"
            placeholder="College of Computing Studies"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={pictureId}>Logo / Emblem (optional)</Label>
          <Input
            id={pictureId}
            name="picture"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
            className="text-xs"
          />
          <p className="text-[11px] text-muted-foreground">
            Optional department emblem or logo (SVG, PNG, JPEG, max 5MB).
          </p>
        </div>

        <ActionMessage state={state} />

        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-border/70">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Creating…" : "Create Department"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function DepartmentCard({
  department,
}: {
  department: DepartmentWithFacultyCount;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [renameState, renameAction, isRenaming] = useActionState(
    renameDepartment,
    INITIAL_STATE,
  );
  const [deleteState, deleteAction, isDeleting] = useActionState(
    deleteDepartment,
    INITIAL_STATE,
  );

  const editCodeId = useId();
  const editNameId = useId();
  const editPictureId = useId();

  const wasRenameSuccessful = renameState.ok && renameState.message !== "";
  useEffect(() => {
    if (wasRenameSuccessful) {
      const timer = setTimeout(() => {
        setEditOpen(false);
      }, 700);
      return () => clearTimeout(timer);
    }
  }, [wasRenameSuccessful]);

  return (
    <>
      <Card className="hover:border-primary/40 transition-all shadow-xs">
        <CardContent className="p-4 sm:p-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <DepartmentAvatar
              name={department.name}
              code={department.code}
              url={department.picture_url}
              size="md"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary shrink-0">
                  {department.code}
                </span>
                <h3 className="font-bold text-foreground text-sm truncate">
                  {department.name}
                </h3>
              </div>
              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                <Users className="size-3.5 text-muted-foreground/80 shrink-0" />
                <span>
                  {department.facultyCount === 1
                    ? "1 eligible faculty member"
                    : `${department.facultyCount} eligible faculty members`}
                </span>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1.5 shrink-0">
            <Link
              href={`/admin/departments/${department.id}`}
              className="inline-flex size-8 items-center justify-center rounded-lg border border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title={`View ${department.code} drill-down`}
              aria-label={`View ${department.code} drill-down`}
            >
              <ExternalLink className="size-3.5" />
            </Link>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={() => setEditOpen(true)}
              title={`Edit ${department.code}`}
              aria-label={`Edit ${department.code}`}
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="icon-sm"
              onClick={() => setDeleteOpen(true)}
              title={`Delete ${department.code}`}
              aria-label={`Delete ${department.code}`}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Edit Department Modal */}
      <Modal
        open={editOpen}
        onOpenChange={setEditOpen}
        title={`Edit ${department.code}`}
        description="Update department code, display name, or photo emblem."
        maxWidth="md"
      >
        <form action={renameAction} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={department.id} />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={editCodeId}>Department Code</Label>
            <Input
              id={editCodeId}
              name="code"
              required
              minLength={2}
              maxLength={10}
              autoComplete="off"
              defaultValue={department.code}
              className="uppercase font-semibold tracking-wider"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={editNameId}>Department Name</Label>
            <Input
              id={editNameId}
              name="name"
              required
              maxLength={120}
              autoComplete="off"
              defaultValue={department.name}
            />
          </div>

          <div className="flex flex-col gap-2 rounded-xl border border-border/80 bg-muted/20 p-3.5">
            <Label htmlFor={editPictureId}>Photo / Emblem</Label>
            {department.picture_url ? (
              <div className="flex items-center gap-3">
                <DepartmentAvatar
                  name={department.name}
                  code={department.code}
                  url={department.picture_url}
                  size="md"
                />
                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-destructive hover:underline">
                  <input
                    type="checkbox"
                    name="removePicture"
                    value="true"
                    className="rounded"
                  />
                  <span>Remove current photo</span>
                </label>
              </div>
            ) : null}
            <Input
              id={editPictureId}
              name="picture"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
              className="text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              Upload a new logo/emblem to replace the current one.
            </p>
          </div>

          <ActionMessage state={renameState} />

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-border/70">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditOpen(false)}
              disabled={isRenaming}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isRenaming}>
              {isRenaming ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Department Modal */}
      <Modal
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${department.code}?`}
        description="Permanently remove this voting department."
        maxWidth="sm"
      >
        <form action={deleteAction} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={department.id} />
          <p className="text-xs text-muted-foreground leading-relaxed">
            Are you sure you want to delete{" "}
            <strong className="text-foreground font-semibold">
              {department.code} · {department.name}
            </strong>
            ? This action cannot be undone. Deletion is automatically blocked if
            faculty, election, or vote records still reference it.
          </p>

          <ActionMessage state={deleteState} />

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-border/70">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting…" : `Delete ${department.code}`}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function DepartmentsManager({
  departments,
}: {
  departments: DepartmentWithFacultyCount[];
}) {
  const [search, setSearch] = useState("");
  const [addModalOpen, setAddModalOpen] = useState(false);

  const filtered = departments.filter((d) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return d.code.toLowerCase().includes(q) || d.name.toLowerCase().includes(q);
  });

  return (
    <div className="flex flex-col gap-5">
      {/* Search & Action Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search departments by code or name…"
            className="pl-9 pr-9 h-10 text-xs sm:text-sm"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>

        <Button
          type="button"
          onClick={() => setAddModalOpen(true)}
          className="gap-2 h-10 px-4 font-semibold shrink-0"
        >
          <Plus className="size-4" />
          <span>Add Department</span>
        </Button>
      </div>

      {/* Departments Grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/60 p-10 text-center">
          <p className="text-sm font-semibold text-foreground">
            {search ? `No departments matching "${search}"` : "No departments yet"}
          </p>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm">
            {search
              ? "Try adjusting your search query to find the department you are looking for."
              : "Click 'Add Department' to create the first voting department."}
          </p>
          {search ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSearch("")}
              className="mt-4"
            >
              Clear Search
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {filtered.map((department) => (
            <DepartmentCard key={department.id} department={department} />
          ))}
        </div>
      )}

      {/* Add Department Modal */}
      <CreateDepartmentModal
        open={addModalOpen}
        onOpenChange={setAddModalOpen}
      />
    </div>
  );
}

// Backwards-compatible stub if needed
export function CreateDepartmentForm() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button type="button" onClick={() => setOpen(true)} className="gap-2">
        <Plus className="size-4" />
        <span>Add Department</span>
      </Button>
      <CreateDepartmentModal open={open} onOpenChange={setOpen} />
    </div>
  );
}
