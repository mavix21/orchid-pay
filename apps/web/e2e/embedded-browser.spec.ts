import { expect, test } from "@playwright/test";

import { submitButton } from "./device";

const instagramOnAndroid =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36 Instagram 330.0.0.0.0 Android";

test.use({ userAgent: instagramOnAndroid });

test("an embedded browser is handed off before the account form mounts and the copied link keeps the fragment", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/create-account#kept");

  await expect(page.getByTestId("embedded-browser")).toBeVisible();
  await expect(page.getByTestId("open-in-browser")).toBeVisible();
  await expect(submitButton(page)).toBeHidden();
  await expect(page.getByTestId("embedded-browser-link")).toBeHidden();

  await page.getByTestId("copy-link").click();

  const copied = await page.evaluate(() => navigator.clipboard.readText());

  expect(copied).toBe(page.url());
  expect(new URL(copied).hash).toBe("#kept");
});
