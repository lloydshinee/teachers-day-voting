"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, QrCode } from "lucide-react";

export function QuickCodeForm() {
  const router = useRouter();
  const [code, setCode] = useState("");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const clean = code.trim().toUpperCase();
    if (!clean) return;
    router.push(`/vote?token=${encodeURIComponent(clean)}`);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full max-w-lg"
    >
      <div className="relative flex-1">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-muted-foreground">
          <QrCode className="size-4" />
        </div>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="e.g. 7K9P-X2MA-Q4LT"
          autoCapitalize="characters"
          spellCheck={false}
          className="h-12 w-full rounded-xl border border-input bg-background/90 pl-10 pr-4 text-base md:text-sm font-mono tracking-wider uppercase text-foreground placeholder:normal-case placeholder:font-sans placeholder:text-muted-foreground placeholder:tracking-normal shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
        />
      </div>
      <button
        type="submit"
        disabled={!code.trim()}
        className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
      >
        <span>Open Ballot</span>
        <ArrowRight className="size-4" />
      </button>
    </form>
  );
}
