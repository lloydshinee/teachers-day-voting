"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Eye, EyeOff, Lock, Mail, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { adminSignIn, type AdminLoginState } from "./actions";

const INITIAL_STATE: AdminLoginState = { ok: true };

export function AdminLoginForm() {
  const [state, formAction, isPending] = useActionState(
    adminSignIn,
    INITIAL_STATE,
  );
  const [showPassword, setShowPassword] = useState(false);

  return (
    <Card className="w-full max-w-md border-border/80 shadow-lg">
      <CardHeader className="space-y-2 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-1">
          <ShieldCheck className="size-6" />
        </div>
        <CardTitle className="text-2xl font-bold tracking-tight text-foreground">
          Administrator Portal
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          Sign in to manage elections, departments, faculty rosters, and voting tokens.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          {state.message ? (
            <div
              role="alert"
              className="rounded-xl border border-destructive/20 bg-destructive/10 p-3.5 text-xs font-semibold text-destructive flex items-start gap-2"
            >
              <span className="shrink-0 mt-0.5">•</span>
              <span>{state.message}</span>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="admin-email" className="text-xs font-semibold">
              Admin Email
            </Label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-3.5 size-4 text-muted-foreground" />
              <Input
                id="admin-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="admin@school.edu"
                className="h-11 pl-10 text-sm"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="admin-password" className="text-xs font-semibold">
              Password
            </Label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-3.5 size-4 text-muted-foreground" />
              <Input
                id="admin-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                placeholder="••••••••••••"
                className="h-11 pl-10 pr-10 text-sm"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-3.5 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>
          </div>

          <Button
            type="submit"
            disabled={isPending}
            className="mt-2 h-11 w-full text-sm font-semibold shadow-xs"
          >
            {isPending ? "Authenticating…" : "Sign In to Admin Console"}
          </Button>
        </form>
      </CardContent>

      <CardFooter className="flex flex-col gap-3 border-t border-border/60 bg-muted/20 pt-4 text-center">
        <p className="text-[11px] text-muted-foreground">
          Protected system · Access is restricted to authorized election administrators allowlisted in the security database.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          <span>Return to Public Homepage</span>
        </Link>
      </CardFooter>
    </Card>
  );
}
