"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Award,
  BarChart2,
  CheckCircle2,
  Home,
  Lock,
  RotateCcw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { cn } from "cn";

import { DepartmentAvatar } from "@/components/department-avatar";
import { FacultyAvatar } from "@/components/faculty-avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  castBallot,
  resolveBallot,
} from "@/lib/vote/actions";
import type {
  FacultyBallot,
  StudentBallot,
  VoterType,
} from "@/lib/vote/schemas";

/**
 * Mobile-first three-step vote flow (spec §§10–11, task 12).
 *
 * One Code entry accepts either a faculty or a student Code: the server
 * derives the voter type and department from the Token row and returns the
 * matching ballot — fellow faculty (self excluded) or that department's
 * frozen Finalists only. Steps: Code entry → department ballot → confirm
 * screen (`You selected: <name>`, Back/Submit) → success screen
 * (`Vote recorded`, Token burned). Under a minute, large touch targets,
 * high contrast, no registration.
 *
 * The client holds only the Code (in memory) and the chosen id across
 * steps. Department, stage, and token type are never submitted — the
 * server re-derives everything from the Token row on each call, and the
 * `cast_student_vote` transaction re-validates the Finalist snapshot, so
 * a cross-department candidate fails server-side no matter what the
 * browser submits. All failures render the single uniform non-oracling
 * error returned by the server, so the UI itself oracles nothing.
 *
 * QR deep-links arrive with the Code prefilled (see `app/vote/page.tsx`)
 * and still require one tap on Continue — never auto-submit, so a stray
 * scan cannot burn a Code unseen.
 */

type Step = "code" | "ballot" | "confirm" | "success";

type VoteBallot = FacultyBallot | StudentBallot;

function StepProgress({ step }: { step: Step }) {
  if (step === "success") {
    return null;
  }

  const steps = [
    { id: "code", label: "Code", num: 1 },
    { id: "ballot", label: "Choose", num: 2 },
    { id: "confirm", label: "Confirm", num: 3 },
  ];

  const currentIdx = step === "code" ? 0 : step === "ballot" ? 1 : 2;

  return (
    <div
      className="flex items-center justify-center gap-2 mb-3"
      aria-label={`Step ${currentIdx + 1} of 3`}
    >
      {steps.map((s, idx) => {
        const isCurrent = idx === currentIdx;
        const isDone = idx < currentIdx;
        return (
          <div key={s.id} className="flex items-center gap-2">
            <div
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all",
                isCurrent
                  ? "bg-primary text-primary-foreground shadow-xs ring-2 ring-primary/20"
                  : isDone
                    ? "bg-primary/15 text-primary font-medium"
                    : "bg-muted text-muted-foreground",
              )}
            >
              <span className="flex size-4 items-center justify-center rounded-full text-[10px] font-bold">
                {isDone ? "✓" : s.num}
              </span>
              <span>{s.label}</span>
            </div>
            {idx < steps.length - 1 && (
              <div
                className={cn(
                  "h-0.5 w-4 sm:w-6 transition-colors",
                  idx < currentIdx ? "bg-primary" : "bg-border",
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function VoteFlow({ initialCode }: { initialCode: string }) {
  const [step, setStep] = useState<Step>("code");
  const [codeInput, setCodeInput] = useState(initialCode);
  const [code, setCode] = useState("");
  const [voterType, setVoterType] = useState<VoterType | null>(null);
  const [ballot, setBallot] = useState<VoteBallot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleCodeSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) {
      return;
    }
    setPending(true);
    setError(null);
    const cleaned = codeInput.trim().toUpperCase();
    const result = await resolveBallot(cleaned);
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setCode(cleaned);
    setVoterType(result.voterType);
    setBallot(result.ballot);
    setSelectedId(null);
    setSearchQuery("");
    setStep("ballot");
  }

  async function handleCast() {
    if (pending || selectedId === null || voterType === null) {
      return;
    }
    setPending(true);
    setError(null);
    const result = await castBallot(code, selectedId);
    setPending(false);
    if (!result.ok) {
      // Token may now be spent or invalid — return to entry with the
      // uniform message rather than stranding the voter on confirm.
      setError(result.message);
      setBallot(null);
      setVoterType(null);
      setSelectedId(null);
      setStep("code");
      return;
    }
    setStep("success");
  }

  function backToCode() {
    setError(null);
    setBallot(null);
    setVoterType(null);
    setSelectedId(null);
    setSearchQuery("");
    setStep("code");
  }

  const selectedCandidate =
    ballot?.candidates.find((candidate) => candidate.id === selectedId) ?? null;
  const selectedName = selectedCandidate?.fullName ?? null;

  const heading =
    step === "code"
      ? "Cast Your Vote"
      : step === "success"
        ? "Vote recorded."
        : voterType === "STUDENT"
          ? "Student Finalist Vote"
          : "Faculty Peer Vote";
  const subheading =
    step === "code" || voterType === null
      ? "Enter your secret voting code to open your department ballot."
      : step === "success"
        ? "Your vote has been verified and securely recorded."
        : voterType === "STUDENT"
          ? "Vote for one honored Finalist in your department."
          : "Vote for exactly one fellow faculty member in your department.";

  const filteredCandidates = (ballot?.candidates ?? []).filter((c) =>
    c.fullName.toLowerCase().includes(searchQuery.trim().toLowerCase()),
  );

  return (
    <section aria-labelledby="vote-heading" className="flex flex-col gap-4">
      <div className="flex flex-col items-center text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3.5 py-1 text-xs font-semibold text-primary mb-2.5 shadow-2xs">
          <Award className="size-3.5" />
          <span>Teachers&apos; Day Voting Booth</span>
          <span className="text-primary/40">•</span>
          <ShieldCheck className="size-3.5" />
          <span>Anonymous Ballot</span>
        </div>
        <h1
          id="vote-heading"
          className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground"
        >
          {heading}
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-muted-foreground max-w-sm mx-auto">
          {subheading}
        </p>
      </div>

      <StepProgress step={step} />

      <Card className="shadow-sm border-border/80 rounded-2xl overflow-hidden">
        {step === "code" ? (
          <>
            <CardHeader className="text-center pb-2">
              <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-2xs">
                <Lock className="size-5" />
              </div>
              <CardTitle className="text-xl font-bold tracking-tight text-foreground">
                Enter your voting Code
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground max-w-xs mx-auto">
                Type the 12-character Code from your printed slip, or scan the QR code with your camera.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {error ? (
                <div
                  role="alert"
                  className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm font-medium text-destructive text-center"
                >
                  {error}
                </div>
              ) : null}

              <form onSubmit={handleCodeSubmit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label
                    htmlFor="vote-code"
                    className="text-xs font-semibold uppercase tracking-wider text-muted-foreground text-center"
                  >
                    Voting Code
                  </Label>
                  <Input
                    id="vote-code"
                    name="code"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    placeholder="XXXX-XXXX-XXXX"
                    value={codeInput}
                    onChange={(event) => setCodeInput(event.target.value.toUpperCase())}
                    className="h-14 text-center text-lg sm:text-xl font-mono tracking-[0.2em] font-bold uppercase rounded-xl border-2 focus-visible:border-primary shadow-xs"
                  />
                  <p className="text-center text-[11px] text-muted-foreground flex items-center justify-center gap-1.5 mt-0.5">
                    <ShieldCheck className="size-3 text-primary" />
                    Single-use cryptographic token · Secret ballot guarantee
                  </p>
                </div>
                <Button
                  type="submit"
                  size="2xl"
                  disabled={pending || codeInput.trim() === ""}
                  className="min-h-[56px] h-14 w-full text-base sm:text-lg font-bold rounded-2xl shadow-md shadow-primary/20 transition-all active:scale-[0.99]"
                >
                  {pending ? "Validating Code…" : "Continue to Ballot"}
                </Button>
                <div className="text-center pt-1">
                  <Link
                    href="/"
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors"
                  >
                    <ArrowLeft className="size-3" />
                    Return to Election Home
                  </Link>
                </div>
              </form>
            </CardContent>
          </>
        ) : null}

        {step === "ballot" && ballot ? (
          <>
            <CardHeader className="pb-3 border-b border-border/50 bg-muted/20">
              <div className="flex items-center gap-3.5">
                <DepartmentAvatar
                  name={ballot.department.name}
                  code={ballot.department.code}
                  url={ballot.department.pictureUrl}
                  size="md"
                />
                <div className="flex flex-1 flex-col min-w-0">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-bold truncate">
                      {ballot.department.name}
                    </CardTitle>
                    <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary shrink-0">
                      {ballot.department.code}
                    </span>
                  </div>
                  <CardDescription className="text-xs truncate mt-0.5">
                    {voterType === "STUDENT"
                      ? "Top-3 Finalists Ballot · Select one honoree"
                      : "Faculty Peer Ballot · Select one fellow member"}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 pt-4">
              {error ? (
                <div
                  role="alert"
                  className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm font-medium text-destructive text-center"
                >
                  {error}
                </div>
              ) : null}

              {ballot.candidates.length > 3 && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    type="search"
                    placeholder="Search candidate by name…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 h-10 text-sm"
                  />
                </div>
              )}

              {ballot.candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  {voterType === "STUDENT"
                    ? "No Finalists are frozen for this department yet."
                    : "No eligible fellow faculty to vote for in this department right now."}
                </p>
              ) : filteredCandidates.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No candidates match &quot;{searchQuery}&quot;.
                </p>
              ) : (
                <ul
                  aria-label={
                    voterType === "STUDENT"
                      ? "Department Finalists"
                      : "Department ballot"
                  }
                  className="flex list-none flex-col gap-2.5 p-0"
                >
                  {filteredCandidates.map((candidate) => {
                    const selected = candidate.id === selectedId;
                    return (
                      <li key={candidate.id}>
                        <button
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setSelectedId(candidate.id)}
                          className={
                            selected
                              ? "flex min-h-16 w-full items-center gap-3.5 rounded-xl border-2 border-primary bg-primary/10 px-4 py-3 text-left transition shadow-xs ring-1 ring-primary/20"
                              : "flex min-h-16 w-full items-center gap-3.5 rounded-xl border border-input bg-card px-4 py-3 text-left transition hover:bg-muted/70 shadow-2xs"
                          }
                        >
                          <FacultyAvatar
                            name={candidate.fullName}
                            url={candidate.pictureUrl}
                          />
                          <div className="flex flex-1 flex-col min-w-0">
                            <span className="text-base font-semibold text-foreground truncate">
                              {candidate.fullName}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {selected ? "Selected choice" : "Tap to select"}
                            </span>
                          </div>
                          <div
                            className={
                              selected
                                ? "flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-2xs"
                                : "size-6 shrink-0 rounded-full border-2 border-muted-foreground/30"
                            }
                          >
                            {selected ? (
                              <svg
                                className="size-3.5 stroke-[3]"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                              >
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            ) : null}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="flex flex-col gap-3 sm:flex-row pt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="2xl"
                  onClick={backToCode}
                  className="min-h-[56px] h-14 w-full sm:flex-1 text-base sm:text-lg font-semibold border-2 border-border/80 hover:bg-muted/70 rounded-2xl transition-all active:scale-[0.99]"
                >
                  <ArrowLeft className="mr-1.5 size-5" />
                  Back
                </Button>
                <Button
                  type="button"
                  size="2xl"
                  disabled={selectedId === null}
                  onClick={() => {
                    setError(null);
                    setStep("confirm");
                  }}
                  className="min-h-[56px] h-14 w-full sm:flex-1 text-base sm:text-lg font-bold rounded-2xl shadow-md shadow-primary/20 transition-all active:scale-[0.99]"
                >
                  Review Choice
                </Button>
              </div>
            </CardContent>
          </>
        ) : null}

        {step === "confirm" ? (
          <>
            <CardHeader className="text-center pb-2">
              <CardTitle className="text-xl font-bold tracking-tight text-foreground">
                Confirm your vote
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground mt-1">
                Please verify your honoree selection before submitting your ballot.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {error ? (
                <div
                  role="alert"
                  className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm font-medium text-destructive text-center"
                >
                  {error}
                </div>
              ) : null}

              <div className="flex flex-col items-center text-center gap-3 rounded-2xl border-2 border-primary/25 bg-gradient-to-b from-primary/10 via-primary/5 to-transparent p-5 shadow-2xs">
                {selectedCandidate ? (
                  <FacultyAvatar
                    name={selectedCandidate.fullName}
                    url={selectedCandidate.pictureUrl}
                    size="lg"
                  />
                ) : null}
                <div>
                  <h3 className="text-xl font-bold text-foreground">
                    You selected: {selectedName}
                  </h3>
                  {ballot ? (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {ballot.department.code} · {ballot.department.name}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="rounded-xl border border-border/80 bg-muted/30 p-3.5 text-xs text-muted-foreground flex items-start gap-2.5">
                <ShieldCheck className="size-4 text-primary shrink-0 mt-0.5" />
                <div className="text-left">
                  <span className="font-semibold text-foreground">Final confirmation:</span>{" "}
                  Submitting your vote is final and anonymous. Your one-time cryptographic code will be safely burned and cannot be used again.
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="2xl"
                  disabled={pending}
                  onClick={() => {
                    setError(null);
                    setStep("ballot");
                  }}
                  className="min-h-[56px] h-14 w-full sm:flex-1 text-base sm:text-lg font-semibold border-2 border-border/80 hover:bg-muted/70 rounded-2xl transition-all active:scale-[0.99]"
                >
                  <RotateCcw className="mr-1.5 size-5" />
                  Change Selection
                </Button>
                <Button
                  type="button"
                  size="2xl"
                  disabled={pending || selectedId === null}
                  onClick={handleCast}
                  className="min-h-[56px] h-14 w-full sm:flex-1 text-base sm:text-lg font-bold rounded-2xl shadow-md shadow-primary/25 transition-all bg-primary hover:bg-primary/95 text-primary-foreground active:scale-[0.99]"
                >
                  {pending ? (
                    "Submitting…"
                  ) : (
                    <>
                      <CheckCircle2 className="mr-1.5 size-5" />
                      Confirm & Cast Vote
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </>
        ) : null}

        {step === "success" ? (
          <CardContent className="flex flex-col items-center text-center p-6 sm:p-8 gap-5">
            <div className="flex size-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400 shadow-xs animate-in zoom-in-95 duration-200">
              <CheckCircle2 className="size-10" />
            </div>

            <div className="flex flex-col gap-1.5">
              <CardTitle className="text-2xl font-bold tracking-tight text-foreground">
                Vote recorded.
              </CardTitle>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                Your vote has been securely recorded.
              </p>
            </div>

            <div className="w-full rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3.5 text-xs text-muted-foreground text-center">
              <span className="font-semibold text-foreground">Token Status:</span> Your single-use voting Code has been permanently retired and cannot be reused.
            </div>

            <div className="flex w-full flex-col sm:flex-row gap-3 mt-1">
              <Link
                href="/"
                className="inline-flex min-h-[52px] h-[52px] w-full sm:flex-1 items-center justify-center rounded-xl border-2 border-input bg-background px-4 text-base font-semibold text-foreground hover:bg-muted transition-colors shadow-2xs"
              >
                <Home className="mr-1.5 size-5" />
                Home Page
              </Link>
              <Link
                href="/results"
                className="inline-flex min-h-[52px] h-[52px] w-full sm:flex-1 items-center justify-center rounded-xl bg-primary px-4 text-base font-bold text-primary-foreground hover:bg-primary/90 shadow-md shadow-primary/20 transition-colors"
              >
                <BarChart2 className="mr-1.5 size-5" />
                View Results
              </Link>
            </div>

            <button
              type="button"
              onClick={backToCode}
              className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors"
            >
              <RotateCcw className="size-3" />
              Vote with another slip
            </button>
          </CardContent>
        ) : null}
      </Card>
    </section>
  );
}
