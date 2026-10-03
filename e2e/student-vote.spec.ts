import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes, randomInt } from "node:crypto";
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
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq < 0) {
      continue;
    }
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
const pepper = process.env.VOTING_TOKEN_PEPPER || "";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomDisplayCode(): string {
  let letters = "";
  for (let i = 0; i < 12; i += 1) {
    letters += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return `${letters.slice(0, 4)}-${letters.slice(4, 8)}-${letters.slice(8, 12)}`;
}

function hashForEntry(display: string, p: string): string {
  const letters = display.replace(/[\s-]+/g, "").toUpperCase();
  return createHash("sha256").update(p + letters, "utf8").digest("hex");
}

test.describe("Student Voting Flow", () => {
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  test("user token 9YVA-BW92-NPUC is rejected with error because election is still in DRAFT stage", async ({
    page,
  }) => {
    // 1. Visit vote page
    await page.goto("/vote");
    await expect(page.locator("text=Enter your voting Code").first()).toBeVisible();

    // 2. Type user's token
    const codeInput = page.locator("#vote-code");
    await codeInput.click();
    await codeInput.pressSequentially("9YVA-BW92-NPUC", { delay: 10 });

    const continueBtn = page.getByRole("button", { name: "Continue to Ballot" });
    await expect(continueBtn).toBeEnabled();

    // 3. Click Continue
    await continueBtn.click();

    // 4. Assert non-oracling rejection message on our alert banner
    const alert = page.locator(".text-destructive[role='alert']");
    await expect(alert).toBeVisible();
    await expect(alert).toHaveText("Invalid or unusable voting code.");
  });

  test("full browser flow: student token in STUDENT_VOTING stage accesses ballot, selects candidate, and casts vote", async ({
    page,
  }) => {
    const runTag = randomBytes(3).toString("hex");
    const testPrefix = `PW_TEST_${runTag}`;

    let electionId: string | null = null;
    let deptId: string | null = null;

    try {
      // 1. Create a test election in STUDENT_VOTING stage
      const { data: election, error: errElec } = await supabase
        .from("elections")
        .insert({
          name: `${testPrefix} Election`,
          academic_year: "2026-2027",
          stage: "STUDENT_VOTING",
          tie_policy_text: "Manual admin pick",
          tie_policy_locked_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      expect(errElec).toBeNull();
      if (!election) throw new Error("Fixture election was not created");
      electionId = election.id;

      // 2. Create department
      const { data: dept, error: errDept } = await supabase
        .from("departments")
        .insert({
          code: `P${runTag.slice(0, 3).toUpperCase()}`,
          name: `${testPrefix} Department`,
        })
        .select("id")
        .single();
      expect(errDept).toBeNull();
      if (!dept) throw new Error("Fixture department was not created");
      deptId = dept.id;

      // Link department to election with finalists_locked_at set
      const { error: errEd } = await supabase.from("election_departments").insert({
        election_id: electionId,
        department_id: deptId,
        finalists_locked_at: new Date().toISOString(),
        tie_pending: false,
      });
      expect(errEd).toBeNull();

      // 3. Create 3 faculty members
      const candidateNames = [
        `Dr. Alice ${runTag}`,
        `Prof. Bob ${runTag}`,
        `Engr. Charlie ${runTag}`,
      ];
      const facultyIds: string[] = [];
      for (const name of candidateNames) {
        const { data: fac, error: errFac } = await supabase
          .from("faculty")
          .insert({
            department_id: deptId,
            full_name: name,
          })
          .select("id")
          .single();
        expect(errFac).toBeNull();
        if (!fac) throw new Error("Fixture faculty was not created");
        facultyIds.push(fac.id);
      }

      // 4. Freeze them as finalists with stage1_votes populated
      for (let r = 0; r < facultyIds.length; r += 1) {
        const { error: errFin } = await supabase.from("finalists").insert({
          election_id: electionId,
          department_id: deptId,
          faculty_id: facultyIds[r],
          stage1_votes: 10 - r,
          rank: r + 1,
        });
        expect(errFin).toBeNull();
      }

      // 5. Mint a student voting token
      const studentCode = randomDisplayCode();
      const tokenHash = hashForEntry(studentCode, pepper);
      const { error: errTok } = await supabase.from("voting_tokens").insert({
        election_id: electionId,
        department_id: deptId,
        token_hash: tokenHash,
        token_type: "STUDENT",
        faculty_id: null,
      });
      expect(errTok).toBeNull();

      // 6. Navigate to /vote
      await page.goto("/vote");
      const codeInput = page.locator("#vote-code");
      await codeInput.click();
      await codeInput.pressSequentially(studentCode, { delay: 10 });
      const continueBtn = page.getByRole("button", { name: "Continue to Ballot" });
      await expect(continueBtn).toBeEnabled();
      await continueBtn.click();

      // 7. Verify we are on Step 2 (Choose) and finalists are shown
      await expect(page.locator("text=Student Finalist Vote")).toBeVisible();
      await expect(page.locator(`text=${candidateNames[0]}`)).toBeVisible();
      await expect(page.locator(`text=${candidateNames[1]}`)).toBeVisible();
      await expect(page.locator(`text=${candidateNames[2]}`)).toBeVisible();

      // 8. Select the second candidate
      await page.click(`button:has-text('${candidateNames[1]}')`);

      // 9. Click Review Choice -> Step 3 (Confirm)
      await page.click("button:has-text('Review Choice')");
      await expect(page.locator("text=Confirm your vote")).toBeVisible();
      await expect(page.locator(`text=${candidateNames[1]}`)).toBeVisible();

      // 10. Click Cast Vote
      await page.click("button:has-text('Cast Vote')");

      // 11. Assert success screen
      await expect(page.locator("text=Vote Successfully Cast!")).toBeVisible();
      await expect(page.locator("text=Your vote has been securely recorded into the encrypted tally.")).toBeVisible();

      // 12. Verify token reuse is immediately blocked
      await page.goto("/vote");
      const codeInputSecond = page.locator("#vote-code");
      await codeInputSecond.click();
      await codeInputSecond.pressSequentially(studentCode, { delay: 10 });
      const secondBtn = page.getByRole("button", { name: "Continue to Ballot" });
      await expect(secondBtn).toBeEnabled();
      await secondBtn.click();
      const alert = page.locator(".text-destructive[role='alert']");
      await expect(alert).toBeVisible();
      await expect(alert).toHaveText("Invalid or unusable voting code.");

    } finally {
      // Cleanup fixture rows
      if (electionId) {
        await supabase.from("voting_tokens").delete().eq("election_id", electionId);
        await supabase.from("votes").delete().eq("election_id", electionId);
        await supabase.from("finalists").delete().eq("election_id", electionId);
        await supabase.from("election_departments").delete().eq("election_id", electionId);
        await supabase.from("elections").delete().eq("id", electionId);
      }
      if (deptId) {
        await supabase.from("faculty").delete().eq("department_id", deptId);
        await supabase.from("departments").delete().eq("id", deptId);
      }
    }
  });
});
