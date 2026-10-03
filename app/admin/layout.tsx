import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AdminHeader } from "@/components/admin-header";
import { AdminSidebar } from "@/components/admin-sidebar";
import { createClient } from "@/lib/supabase/server";

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const headerList = await headers();
  const pathname = headerList.get("x-pathname") || "";
  const isLoginPage =
    pathname === "/admin/login" ||
    pathname.startsWith("/admin/login") ||
    pathname.endsWith("/login");

  if (isLoginPage) {
    return <>{children}</>;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/admin/login");
  }

  const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");
  if (adminError || isAdmin !== true) {
    redirect("/admin/login");
  }

  const userEmail = user.email || "Administrator";

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-background text-foreground">
      {/* Responsive sidebar navigation */}
      <AdminSidebar userEmail={userEmail} />

      {/* Main content viewport */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Dashboard header beside the sidebar */}
        <AdminHeader userEmail={userEmail} />
        <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
