import { expect, test } from "@playwright/test";
import { AccountAddress } from "@workspace/wallet";
import * as Schema from "effect/Schema";

import {
  countPasskeyPrompts,
  enrollWallet,
  freshUsername,
  markWalletRecovered,
  walletActive,
} from "./device";

test("reactivates a recovered wallet whose account is still on the network without a passkey prompt", async ({
  page,
}) => {
  const prompts = await countPasskeyPrompts(page);
  const { address } = await enrollWallet(page, freshUsername());
  const wallet = Schema.decodeSync(AccountAddress)(address);
  const signedUp = await prompts();

  markWalletRecovered(wallet);

  await page.goto("/home");

  await expect(page.getByTestId("open-send")).toBeVisible({ timeout: 120_000 });
  await expect.poll(() => walletActive(wallet)).toBe(true);
  expect(await prompts()).toEqual(signedUp);
});
