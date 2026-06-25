import { test, expect } from "@playwright/test";

test("home renders the norms node", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Papert Lab wiki norms"
  );
});

test("unknown slug shows not-found", async ({ page }) => {
  await page.goto("/does-not-exist");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("not found");
});
