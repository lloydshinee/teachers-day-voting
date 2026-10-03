import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { AdminLoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Admin Sign In · Teachers' Day",
  description: "Secure administrator authentication portal.",
};

export default async function AdminLoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: isAdmin } = await supabase.rpc("is_admin");
    if (isAdmin === true) {
      redirect("/admin");
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 sm:p-6 bg-radial-[at_top] from-primary/5 via-background to-background">
      <AdminLoginForm />
    </div>
  );
}
