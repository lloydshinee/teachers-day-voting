"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import {
  Archive,
  ArrowRightLeft,
  Check,
  Pencil,
  Plus,
  Search,
  Users,
  X,
} from "lucide-react";

import { DepartmentAvatar } from "@/components/department-avatar";
import { FacultyAvatar } from "@/components/faculty-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import {
  archiveFaculty,
  createFaculty,
  moveFaculty,
  renameFaculty,
} from "@/lib/faculty/actions";
import type {
  DepartmentFacultyGroup,
  FacultyActionState,
  FacultyDepartmentRow,
  FacultyRow,
} from "@/lib/faculty/schemas";

const INITIAL_STATE: FacultyActionState = { ok: true, message: "" };

const SELECT_CLASS =
  "h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-1 text-base md:text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";

function ActionMessage({ state }: { state: FacultyActionState }) {
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

export interface FacultyManagerElection {
  id: string;
  name: string;
  academic_year: string;
  stage: string;
}

export function CreateFacultyModal({
  open,
  onOpenChange,
  departments,
  initialDepartmentId,
  elections = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  departments: FacultyDepartmentRow[];
  initialDepartmentId?: string;
  elections?: FacultyManagerElection[];
}) {
  const [state, formAction, isPending] = useActionState(
    createFaculty,
    INITIAL_STATE,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const fullNameRef = useRef<HTMLInputElement>(null);

  const [selectedElectionId, setSelectedElectionId] = useState<string>(
    elections[0]?.id || "",
  );
  const [generateCode, setGenerateCode] = useState<boolean>(true);

  // Preserve the chosen department so the user doesn't have to re-select each time!
  const [selectedDeptId, setSelectedDeptId] = useState<string>(
    initialDepartmentId || departments[0]?.id || "",
  );

  // When initialDepartmentId changes (e.g. user selected a different filter), update default
  const [prevInitialId, setPrevInitialId] = useState(initialDepartmentId);
  if (initialDepartmentId !== prevInitialId) {
    setPrevInitialId(initialDepartmentId);
    if (initialDepartmentId) {
      setSelectedDeptId(initialDepartmentId);
    }
  }

  const wasSuccessful = state.ok && state.message !== "";
  useEffect(() => {
    if (wasSuccessful) {
      // Clear name and picture, keep the department!
      if (fullNameRef.current) fullNameRef.current.value = "";
      const fileInput = formRef.current?.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement | null;
      if (fileInput) fileInput.value = "";
      // Re-focus the full name input for immediate next entry
      fullNameRef.current?.focus();
    }
  }, [wasSuccessful]);

  const nameId = useId();
  const deptId = useId();
  const picId = useId();

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Add Faculty Member"
      description="Register an eligible faculty Candidate under their college."
      maxWidth="md"
    >
      <form ref={formRef} action={formAction} className="flex flex-col gap-4">
        {/* Department selector (retains selected department) */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={deptId}>Department / College</Label>
          <select
            id={deptId}
            name="departmentId"
            required
            className={SELECT_CLASS}
            value={selectedDeptId}
            onChange={(e) => setSelectedDeptId(e.target.value)}
          >
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.code} · {department.name}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-muted-foreground">
            Selected college is remembered so you can add multiple teachers quickly.
          </p>
        </div>

        {/* Full name input */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={nameId}>Full Name</Label>
          <Input
            ref={fullNameRef}
            id={nameId}
            name="fullName"
            required
            maxLength={120}
            autoComplete="off"
            placeholder="e.g. Maria Santos, PhD"
          />
        </div>

        {/* Photo file input */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={picId}>Photo (optional)</Label>
          <Input
            id={picId}
            name="picture"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="text-xs"
          />
          <p className="text-[11px] text-muted-foreground">
            Optional faculty picture (JPEG, PNG, WebP, max 5MB).
          </p>
        </div>

        {elections.length > 0 ? (
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 flex flex-col gap-2">
            <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-foreground">
              <input
                type="checkbox"
                name="generateCode"
                value="true"
                checked={generateCode}
                onChange={(e) => setGenerateCode(e.target.checked)}
                className="size-4 rounded accent-primary"
              />
              <span>Generate Voting Code (one-click)</span>
            </label>
            {generateCode ? (
              <div className="flex flex-col gap-1 mt-1">
                <Label htmlFor="election-select" className="text-[11px] text-muted-foreground">
                  Target Election
                </Label>
                <select
                  id="election-select"
                  name="electionId"
                  className={SELECT_CLASS}
                  value={selectedElectionId}
                  onChange={(e) => setSelectedElectionId(e.target.value)}
                >
                  {elections.map((elec) => (
                    <option key={elec.id} value={elec.id}>
                      {elec.name} ({elec.academic_year}) · {elec.stage}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-muted-foreground">
                  Issues a single-use voting Code for this faculty member in the selected election.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        <ActionMessage state={state} />

        <div className="flex items-center justify-between pt-2 border-t border-border/70">
          <span className="text-[11px] text-muted-foreground">
            {wasSuccessful ? (
              <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                <Check className="size-3.5" /> Added! Enter next name or click Done.
              </span>
            ) : null}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Done
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Adding…" : "Add Member"}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

export function FacultyCard({
  faculty,
  departments,
  departmentCode,
}: {
  faculty: FacultyRow;
  departments: FacultyDepartmentRow[];
  departmentCode?: string;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const [renameState, renameAction, isRenaming] = useActionState(
    renameFaculty,
    INITIAL_STATE,
  );
  const [moveState, moveAction, isMoving] = useActionState(
    moveFaculty,
    INITIAL_STATE,
  );
  const [archiveState, archiveAction, isArchiving] = useActionState(
    archiveFaculty,
    INITIAL_STATE,
  );

  const otherDepartments = departments.filter(
    (department) => department.id !== faculty.department_id,
  );

  const isArchived = faculty.archived_at !== null;
  const editNameId = useId();
  const editPicId = useId();
  const moveDeptId = useId();

  const wasRenameSuccessful = renameState.ok && renameState.message !== "";
  useEffect(() => {
    if (wasRenameSuccessful) {
      const timer = setTimeout(() => setEditOpen(false), 700);
      return () => clearTimeout(timer);
    }
  }, [wasRenameSuccessful]);

  const wasMoveSuccessful = moveState.ok && moveState.message !== "";
  useEffect(() => {
    if (wasMoveSuccessful) {
      const timer = setTimeout(() => setMoveOpen(false), 700);
      return () => clearTimeout(timer);
    }
  }, [wasMoveSuccessful]);

  return (
    <>
      <Card className={`transition-all shadow-xs ${isArchived ? "opacity-60 bg-muted/20" : "hover:border-primary/40"}`}>
        <CardContent className="p-3.5 sm:p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <FacultyAvatar
              name={faculty.full_name}
              url={faculty.picture_url}
              size="md"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-foreground text-sm truncate">
                  {faculty.full_name}
                </h4>
                {isArchived ? (
                  <span className="rounded-md bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive shrink-0">
                    Archived
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                {departmentCode ? (
                  <span className="font-semibold text-primary/80">
                    {departmentCode}
                  </span>
                ) : null}
                <span>
                  {faculty.picture_url ? "Photo uploaded" : "No photo"}
                </span>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          {!isArchived ? (
            <div className="flex items-center gap-1 shrink-0">
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={() => setEditOpen(true)}
                title="Edit faculty details"
                aria-label={`Edit ${faculty.full_name}`}
              >
                <Pencil className="size-3.5" />
              </Button>
              {otherDepartments.length > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  onClick={() => setMoveOpen(true)}
                  title="Move to another department"
                  aria-label={`Move ${faculty.full_name}`}
                >
                  <ArrowRightLeft className="size-3.5" />
                </Button>
              ) : null}
              <Button
                type="button"
                variant="destructive"
                size="icon-sm"
                onClick={() => setArchiveOpen(true)}
                title="Archive faculty member"
                aria-label={`Archive ${faculty.full_name}`}
              >
                <Archive className="size-3.5" />
              </Button>
            </div>
          ) : (
            <span className="text-[11px] text-muted-foreground italic shrink-0">
              Archived
            </span>
          )}
        </CardContent>
      </Card>

      {/* Edit Details Modal */}
      <Modal
        open={editOpen}
        onOpenChange={setEditOpen}
        title={`Edit ${faculty.full_name}`}
        description="Update faculty name or profile picture."
        maxWidth="md"
      >
        <form action={renameAction} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={faculty.id} />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={editNameId}>Full Name</Label>
            <Input
              id={editNameId}
              name="fullName"
              required
              maxLength={120}
              autoComplete="off"
              defaultValue={faculty.full_name}
            />
          </div>

          <div className="flex flex-col gap-2 rounded-xl border border-border/80 bg-muted/20 p-3.5">
            <Label htmlFor={editPicId}>Photo</Label>
            {faculty.picture_url ? (
              <div className="flex items-center gap-3">
                <FacultyAvatar
                  name={faculty.full_name}
                  url={faculty.picture_url}
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
              id={editPicId}
              name="picture"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              Upload a new picture (JPEG, PNG, WebP, max 5MB).
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
              {isRenaming ? "Saving…" : "Save Details"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Move Department Modal */}
      {otherDepartments.length > 0 ? (
        <Modal
          open={moveOpen}
          onOpenChange={setMoveOpen}
          title={`Move ${faculty.full_name}`}
          description="Reassign faculty member to another department."
          maxWidth="sm"
        >
          <form action={moveAction} className="flex flex-col gap-4">
            <input type="hidden" name="id" value={faculty.id} />

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={moveDeptId}>Destination Department</Label>
              <select
                id={moveDeptId}
                name="departmentId"
                required
                className={SELECT_CLASS}
                defaultValue=""
              >
                <option value="" disabled>
                  Choose destination department
                </option>
                {otherDepartments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.code} · {department.name}
                  </option>
                ))}
              </select>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Moving archives this faculty member in the current department and
              creates a clean entry in the destination department. Past votes
              cast remain valid.
            </p>

            <ActionMessage state={moveState} />

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-border/70">
              <Button
                type="button"
                variant="outline"
                onClick={() => setMoveOpen(false)}
                disabled={isMoving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isMoving}>
                {isMoving ? "Moving…" : "Move Department"}
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {/* Archive Modal */}
      <Modal
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={`Archive ${faculty.full_name}?`}
        description="Archive this faculty member from active voting."
        maxWidth="sm"
      >
        <form action={archiveAction} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={faculty.id} />
          <p className="text-xs text-muted-foreground leading-relaxed">
            Archiving removes <strong className="text-foreground">{faculty.full_name}</strong> from
            future ballots and cancels any unused voting Token. Any votes they
            already cast will still stand.
          </p>

          <ActionMessage state={archiveState} />

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-border/70">
            <Button
              type="button"
              variant="outline"
              onClick={() => setArchiveOpen(false)}
              disabled={isArchiving}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={isArchiving}
            >
              {isArchiving ? "Archiving…" : `Archive ${faculty.full_name}`}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function FacultyManager({
  groups,
  departments,
  totalEligible,
  totalArchived: _totalArchived,
  elections = [],
}: {
  groups: DepartmentFacultyGroup[];
  departments: FacultyDepartmentRow[];
  totalEligible: number;
  totalArchived?: number;
  elections?: FacultyManagerElection[];
}) {
  const [search, setSearch] = useState("");
  const [selectedDeptId, setSelectedDeptId] = useState<string>("ALL");
  const [addModalOpen, setAddModalOpen] = useState(false);

  // Filter groups according to department selection and search query
  const filteredGroups = groups
    .filter((group) => {
      if (selectedDeptId === "ALL") return true;
      return group.department.id === selectedDeptId;
    })
    .map((group) => {
      const q = search.trim().toLowerCase();
      if (!q) return group;
      return {
        ...group,
        faculty: group.faculty.filter((f) =>
          f.full_name.toLowerCase().includes(q),
        ),
        archived: group.archived.filter((f) =>
          f.full_name.toLowerCase().includes(q),
        ),
      };
    })
    .filter((group) => {
      // If searching, only keep groups that have matching faculty
      if (search.trim()) {
        return group.faculty.length > 0 || group.archived.length > 0;
      }
      return true;
    });

  return (
    <div className="flex flex-col gap-5">
      {/* Search & Action Controls */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search faculty by name…"
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
          <span>Add Faculty Member</span>
        </Button>
      </div>

      {/* Department Filter Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
        <button
          type="button"
          onClick={() => setSelectedDeptId("ALL")}
          className={`rounded-xl px-3 py-1.5 text-xs font-semibold shrink-0 transition-colors ${
            selectedDeptId === "ALL"
              ? "bg-primary text-primary-foreground shadow-xs"
              : "border border-input bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          All Departments ({totalEligible})
        </button>

        {departments.map((dept) => {
          const group = groups.find((g) => g.department.id === dept.id);
          const count = group?.eligibleCount ?? 0;
          const isSelected = selectedDeptId === dept.id;

          return (
            <button
              key={dept.id}
              type="button"
              onClick={() => setSelectedDeptId(dept.id)}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold shrink-0 transition-colors ${
                isSelected
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "border border-input bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <span>{dept.code}</span>
              <span className={`text-[10px] ${isSelected ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                ({count})
              </span>
            </button>
          );
        })}
      </div>

      {/* Faculty List / Groups */}
      {filteredGroups.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/60 p-10 text-center">
          <Users className="size-8 text-muted-foreground/60 mb-2" />
          <p className="text-sm font-semibold text-foreground">
            {search
              ? `No faculty found matching "${search}"`
              : "No faculty members in this department yet"}
          </p>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm">
            {search
              ? "Try typing a different name or switch to All Departments."
              : "Click 'Add Faculty Member' to register candidates."}
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
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={() => setAddModalOpen(true)}
              className="mt-4"
            >
              Add Faculty to This College
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {filteredGroups.map((group) => (
            <div key={group.department.id} className="flex flex-col gap-3">
              {/* Department group header */}
              <div className="flex items-center justify-between border-b border-border/70 pb-2">
                <div className="flex items-center gap-2.5">
                  <DepartmentAvatar
                    name={group.department.name}
                    code={group.department.code}
                    url={group.department.picture_url}
                    size="sm"
                  />
                  <div>
                    <h3 className="text-sm font-bold text-foreground">
                      {group.department.code} · {group.department.name}
                    </h3>
                  </div>
                </div>
                <span className="text-xs font-semibold text-muted-foreground">
                  {group.faculty.length} eligible
                  {group.archived.length > 0 ? ` · ${group.archived.length} archived` : ""}
                </span>
              </div>

              {/* Faculty member cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {group.faculty.map((faculty) => (
                  <FacultyCard
                    key={faculty.id}
                    faculty={faculty}
                    departments={departments}
                    departmentCode={group.department.code}
                  />
                ))}
                {group.archived.map((faculty) => (
                  <FacultyCard
                    key={faculty.id}
                    faculty={faculty}
                    departments={departments}
                    departmentCode={group.department.code}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Faculty Modal */}
      <CreateFacultyModal
        open={addModalOpen}
        onOpenChange={setAddModalOpen}
        departments={departments}
        initialDepartmentId={selectedDeptId !== "ALL" ? selectedDeptId : undefined}
        elections={elections}
      />
    </div>
  );
}

// Backwards-compatible stubs if needed
export function CreateFacultyForm({
  departments,
}: {
  departments: FacultyDepartmentRow[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button type="button" onClick={() => setOpen(true)} className="gap-2">
        <Plus className="size-4" />
        <span>Add Faculty Member</span>
      </Button>
      <CreateFacultyModal
        open={open}
        onOpenChange={setOpen}
        departments={departments}
      />
    </div>
  );
}

export function DepartmentFacultyGroup({
  group,
  departments,
}: {
  group: DepartmentFacultyGroup;
  departments: FacultyDepartmentRow[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="font-bold text-sm text-foreground">
          {group.department.code} · {group.department.name}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {group.faculty.map((faculty) => (
          <FacultyCard
            key={faculty.id}
            faculty={faculty}
            departments={departments}
            departmentCode={group.department.code}
          />
        ))}
      </div>
    </div>
  );
}
