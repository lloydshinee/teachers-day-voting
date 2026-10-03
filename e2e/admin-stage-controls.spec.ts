import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

function loadDotenvFile(): void {
  const dotenvPath = path.join(process.cwd(), ".env.local");
  let raw: string;
  try {
    raw = fs.readFileSync(dotenvPath, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    if (key !== "" && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotenvFile();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://localhost:8000";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

test.describe("Admin Election Stage Controls", () => {
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  let electionId: string;

  test.beforeAll(async () => {
    // Find the draft election or create one
    const { data: existing } = await supabase
      .from("elections")
      .select("id, stage")
      .eq("stage", "DRAFT")
      .limit(1)
      .maybeSingle();

    if (existing) {
      electionId = existing.id;
    } else {
      const { data: created, error } = await supabase
        .from("elections")
        .insert({
          name: "Test Election 2026",
          academic_year: "2026-2027",
          stage: "DRAFT",
          tie_policy_text: "Manual admin pick",
        })
        .select("id")
        .single();
      if (error || !created) {
        throw new Error("Failed to set up test election: " + error?.message);
      }
      electionId = created.id;
    }
  });

  test.afterAll(async () => {
    // Revert election back to DRAFT so it doesn't leave state dirty
    if (electionId) {
      await supabase
        .from("elections")
        .update({ stage: "DRAFT", tie_policy_locked_at: null })
        .eq("id", electionId);
    }
  });

  test("clicking 'Open Faculty Voting' advances election stage from DRAFT to FACULTY_VOTING without server action errors", async ({
    page,
  }) => {
    // 1. Log in as admin
    await page.goto("/admin/login");
    await page.locator("#admin-email").fill("admin@school.edu");
    await page.locator("#admin-password").fill("AdminTeachersDay2026!");
    await page.getByRole("button", { name: "Sign In to Admin Console" }).click();

    // 2. Wait for redirect to /admin
    await page.waitForURL("/admin**", { timeout: 10000 });
    await expect(page.locator("h1:has-text('Election Dashboard')")).toBeVisible();

    // 3. Verify stage is Draft
    await expect(page.locator("text=Election Status")).toBeVisible();
    await expect(page.locator("span:has-text('Draft')").first()).toBeVisible();

    // 4. Find the 'Open Faculty Voting' button
    const openVotingBtn = page.getByRole("button", { name: "Open Faculty Voting" });
    await expect(openVotingBtn).toBeVisible();

    // 5. Handle the confirm prompt
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("Are you sure you want to open Faculty Voting?");
      await dialog.accept();
    });

    // 6. Click the button to trigger advanceElectionStage
    await openVotingBtn.click();

    // 7. Verify no Next.js error overlay or crash
    const errorOverlay = page.locator("nextjs-portal, [data-nextjs-dialog-header]");
    await expect(errorOverlay).not.toBeVisible();

    // 8. Verify the page updates to show Faculty Voting Open
    await expect(page.locator("span:has-text('Faculty Voting Open')").first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole("button", { name: "Close Faculty Voting" })).toBeVisible();

    // 9. Verify in database
    const { data: updated } = await supabase
      .from("elections")
      .select("stage, tie_policy_locked_at")
      .eq("id", electionId)
      .single();

    expect(updated?.stage).toBe("FACULTY_VOTING");
    expect(updated?.tie_policy_locked_at).not.toBeNull();
  });
});
