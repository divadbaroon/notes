import { test, expect } from "@playwright/test";

test("home renders the evergreen note", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Evergreen note-writing"
  );
});

test("a slug path renders that note and links resolve to titles", async ({ page }) => {
  await page.goto("/transient");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("transient notes");
  const link = page.locator('.note-prose a[data-slug="evergreen"]').first();
  await expect(link).toBeVisible();
});

test("unknown slug shows not-found", async ({ page }) => {
  await page.goto("/does-not-exist");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("not found");
});
