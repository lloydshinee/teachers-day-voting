import type { Metadata } from "next";

import { VoteFlow } from "./forms";

export const metadata: Metadata = {
  title: "Vote · Teachers' Day",
  description:
    "Anonymous vote: enter your voting Code, choose one name on your department ballot, confirm.",
};

/**
 * Anonymous `/vote` entry (spec §§10–11, task 12).
 *
 * Dedicated distraction-free voting page without site navigation headers or footers,
 * allowing voters to focus entirely on their ballot.
 *
 * One entry accepts either a faculty or a student Code: the server derives
 * the voter type and department from the Token row and shows fellow faculty
 * (self excluded) or that department's frozen Finalists only.
 *
 * QR deep-links arrive as `/vote?token=<CODE>` — the Code prefills the
 * entry field only, never auto-submits, so a stray scan cannot burn a Code
 * unseen. Manual entry is always available. All validation happens
 * server-side in `lib/vote/actions.ts`; this page holds no token state.
 */
export default async function VotePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const resolved = await searchParams;
  const initialCode =
    typeof resolved.token === "string" ? resolved.token : "";

  return (
    <div className="flex flex-1 min-h-screen flex-col justify-center py-8 sm:py-12 bg-radial-[at_top] from-primary/5 via-background to-background">
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 sm:px-6">
        <VoteFlow initialCode={initialCode} />
      </main>
    </div>
  );
}
