import { test, expect } from "@playwright/test";

test.describe("Mobile Responsiveness (Phone Viewport: 390x844)", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("public home page is responsive without horizontal overflow", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    // Verify brand and mobile hamburger are visible
    await expect(page.locator("header")).toBeVisible();
    const menuBtn = page.getByRole("button", { name: "Open menu" });
    await expect(menuBtn).toBeVisible();

    // Open mobile menu drawer
    await menuBtn.click();
    const mobileNav = page.getByRole("navigation", { name: "Mobile Navigation" });
    await expect(mobileNav).toBeVisible();
    await expect(mobileNav.getByRole("link", { name: "Cast Vote" })).toBeVisible();
    await expect(mobileNav.getByRole("link", { name: "Published Results" })).toBeVisible();

    // Close mobile menu drawer
    const closeBtn = page.getByRole("button", { name: "Close menu" });
    await closeBtn.click();
    await expect(page.getByRole("navigation", { name: "Mobile Navigation" })).not.toBeVisible();

    // Verify quick code input fits viewport without page overflow
    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(hasHorizontalOverflow).toBe(false);
  });

  test("voter flow on mobile viewport scales cleanly", async ({ page }) => {
    await page.goto("/vote", { waitUntil: "networkidle" });

    // Verify vote input is sized for mobile touch
    const codeInput = page.locator("#vote-code");
    await expect(codeInput).toBeVisible();
    const box = await codeInput.boundingBox();
    expect(box).not.toBeNull();
    // Height should be at least 44px (Apple HIG guideline for touch targets)
    expect(box!.height).toBeGreaterThanOrEqual(44);

    // Verify Continue button fits mobile width and is touch-friendly
    const continueBtn = page.getByRole("button", { name: "Continue to Ballot" });
    await expect(continueBtn).toBeVisible();
    const btnBox = await continueBtn.boundingBox();
    expect(btnBox).not.toBeNull();
    expect(btnBox!.height).toBeGreaterThanOrEqual(44);

    // Verify no horizontal overflow on phone
    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(hasOverflow).toBe(false);
  });

  test("published results page scales cleanly on mobile", async ({ page }) => {
    await page.goto("/results", { waitUntil: "networkidle" });
    await expect(page.locator("h1")).toHaveText("Published Results");

    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(hasOverflow).toBe(false);
  });

  test("admin login portal is mobile-optimized", async ({ page }) => {
    await page.goto("/admin/login", { waitUntil: "networkidle" });

    await expect(page.locator("text=Administrator Portal")).toBeVisible();
    const emailInput = page.locator("#admin-email");
    const passwordInput = page.locator("#admin-password");
    const submitBtn = page.getByRole("button", { name: "Sign In to Admin Console" });

    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();
    await expect(submitBtn).toBeVisible();

    const emailBox = await emailInput.boundingBox();
    expect(emailBox!.height).toBeGreaterThanOrEqual(40);

    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(hasOverflow).toBe(false);
  });

  test("admin console on mobile has mobile header bar and functional slide-out drawer", async ({
    page,
  }) => {
    // 1. Sign in as admin
    await page.goto("/admin/login", { waitUntil: "networkidle" });
    await page.locator("#admin-email").fill("admin@school.edu");
    await page.locator("#admin-password").fill("AdminTeachersDay2026!");
    await page.getByRole("button", { name: "Sign In to Admin Console" }).click();

    // 2. Wait for redirect to /admin
    await page.waitForURL("/admin**", { timeout: 10000 });
    await expect(page.locator("h1:has-text('Election Dashboard')")).toBeVisible();

    // 3. Verify mobile sticky top bar is visible
    const mobileHeader = page.locator("header, div").filter({ hasText: "Admin Console" }).first();
    await expect(mobileHeader).toBeVisible();

    // 4. Verify menu trigger button is visible and opens sidebar drawer
    const menuBtn = page.getByRole("button", { name: "Open navigation sidebar" });
    await expect(menuBtn).toBeVisible();
    await menuBtn.click();

    // 5. Drawer slide-out is visible with navigation links and sign out
    const drawerNav = page.locator("aside.md\\:hidden");
    await expect(drawerNav).toBeVisible();
    await expect(drawerNav.locator("text=Departments")).toBeVisible();
    await expect(drawerNav.locator("text=Faculty Roster")).toBeVisible();
    await expect(drawerNav.locator("text=Faculty Codes")).toBeVisible();
    await expect(drawerNav.locator("text=Student Codes")).toBeVisible();
    await expect(drawerNav.locator("text=admin@school.edu")).toBeVisible();
    await expect(drawerNav.locator("text=Sign Out")).toBeVisible();

    // 6. Navigate to Faculty Roster via mobile drawer
    await drawerNav.locator("text=Faculty Roster").click();
    await page.waitForURL("**/admin/faculty**", { timeout: 10000 });

    // 7. Verify Faculty page on mobile has no horizontal page overflow
    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(hasOverflow).toBe(false);

    // 8. Verify department pills are scrollable horizontally
    const pillContainer = page.locator(".overflow-x-auto").first();
    await expect(pillContainer).toBeVisible();
  });
});
