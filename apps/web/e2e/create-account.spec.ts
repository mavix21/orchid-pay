import { type Page, expect, test } from "@playwright/test";
import { AccountAddress } from "@workspace/wallet";
import * as Schema from "effect/Schema";

import {
  addAuthenticator,
  countPasskeyPrompts,
  freshUsername,
  storedWalletAddress,
  storedWalletRecord,
  submitButton,
  usernameInput,
  walletActive,
} from "./device";

const forgetDevice = async (page: Page) => {
  await page.context().clearCookies();
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase("orchid-device");

        request.addEventListener("success", () => resolve());
        request.addEventListener("error", () => reject(request.error));
      }),
  );
};

test("redirects on the server by whether the device holds a wallet", async ({
  request,
}) => {
  const withoutWallet = await request.get("/home", { maxRedirects: 0 });

  const withWallet = await request.get("/", {
    maxRedirects: 0,
    headers: { cookie: "orchid-wallet=1" },
  });

  expect(withoutWallet.status()).toBe(307);
  expect(withoutWallet.headers().location).toBe("/");
  expect(withWallet.status()).toBe(307);
  expect(withWallet.headers().location).toBe("/home");
});

test("creates an open wallet that shows its deposit address after exactly two passkey prompts", async ({
  page,
}) => {
  await addAuthenticator(page, true);

  const prompts = await countPasskeyPrompts(page);

  await page.goto("/");

  const username = freshUsername();

  await page.getByTestId("start-create").click();
  await usernameInput(page).fill(username);
  await submitButton(page).click();

  const step = page.getByTestId("enrollment-step");

  await expect(step).toBeVisible({ timeout: 30_000 });
  await expect(step).toHaveAttribute("data-stage", "activate");
  expect(await storedWalletRecord(page)).toBe(false);
  expect(await prompts()).toEqual({ create: 1, get: 0 });

  await page.getByTestId("enrollment-continue").click();

  await expect(page.getByTestId("open-send")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("session-confirmation")).toBeHidden();

  const homeUsername = page.getByTestId("home-username");

  await expect(homeUsername).toBeVisible();
  await expect(homeUsername).toHaveAttribute("data-username", username);
  expect(await storedWalletRecord(page)).toBe(true);
  expect(await prompts()).toEqual({ create: 1, get: 1 });

  const address = await storedWalletAddress(page);

  await expect
    .poll(() => walletActive(Schema.decodeSync(AccountAddress)(address)), {
      timeout: 120_000,
    })
    .toBe(true);

  await page.getByTestId("open-receive").click();
  await expect(page.getByTestId("deposit-address")).toHaveAttribute(
    "data-address",
    address,
    { timeout: 60_000 },
  );
  expect(await prompts()).toEqual({ create: 1, get: 1 });

  await forgetDevice(page);
  await page.goto("/");
  await page.getByTestId("start-restore").click();
  await expect(page).toHaveURL("/restore");
  await page.getByTestId("restore-submit").click();
  await page.getByTestId("restore-submit").click();

  await expect(page.getByTestId("open-send")).toBeVisible({ timeout: 60_000 });
  await expect(homeUsername).toBeVisible();
  await expect(homeUsername).toHaveAttribute("data-username", username);
  expect(await storedWalletRecord(page)).toBe(true);
});

test("refuses creation when the passkey has no PRF", async ({ page }) => {
  await addAuthenticator(page, false);

  const username = freshUsername();

  await page.goto("/create-account");
  await usernameInput(page).fill(username);
  await submitButton(page).click();

  const step = page.getByTestId("enrollment-step");

  await expect(step).toBeVisible({ timeout: 30_000 });
  await expect(step).toHaveAttribute("data-stage", "activate");
  expect(await storedWalletRecord(page)).toBe(false);

  await page.getByTestId("enrollment-continue").click();

  await expect(page.getByTestId("prf-unsupported")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("enrollment-continue")).toBeHidden();
  await expect(page).toHaveURL("/create-account");
  expect(await storedWalletRecord(page)).toBe(false);
});
