"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

export type AdminLoginState = {
  ok: boolean;
  message?: string;
};

const loginSchema = z.object({
  email: z.string().trim().email("Please enter a valid email address."),
  password: z.string().min(1, "Password is required."),
});

export async function adminSignIn(
  _prevState: AdminLoginState,
  formData: FormData,
): Promise<AdminLoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message || "Invalid input.",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error || !data.user) {
    return {
      ok: false,
      message: "Invalid email or password.",
    };
  }

  // Verify the user is an administrator in public.admins
  const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");
  if (adminError || isAdmin !== true) {
    await supabase.auth.signOut();
    return {
      ok: false,
      message:
        "Access denied. This account does not have administrator privileges.",
    };
  }

  revalidatePath("/admin", "layout");
  redirect("/admin");
}

export async function adminSignOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/admin", "layout");
  redirect("/admin/login");
}
