import { type Page, expect, test } from "@playwright/test";
import {
  AccountAddress,
  ExternalMemoRequired,
  TransferStep,
} from "@workspace/wallet";
import * as Schema from "effect/Schema";

import {
  enrollWallet,
  freshUsername,
  openWallet,
  serverFunction,
} from "./device";
import { baseAsset } from "@workspace/wallet";
import { fundUsdc, newWalletAddress } from "@workspace/wallet/local-chain";

const choose = (page: Page, destination: "address" | "username") =>
  page.getByTestId(`choose-${destination}`).click();

const fill = async (page: Page, recipient: string, amount: string) => {
  await page.getByRole("textbox").fill(recipient);
  await page.getByTestId("continue-recipient").click();
  await page.getByRole("textbox").fill(amount);
};

const review = (page: Page) => page.getByTestId("review-payment").click();

test("pays a username in USDC, resumes after a reload and refuses an unpayable amount or a missing exchange memo", async ({
  page,
  browser,
}) => {
  test.setTimeout(420_000);

  const recipientContext = await browser.newContext(test.info().project.use);
  const recipient = freshUsername();

  await openWallet(await recipientContext.newPage(), recipient);
  await recipientContext.close();

  const { address: sender } = await enrollWallet(page, freshUsername());

  await fundUsdc(sender, 1_000_000);

  await page.goto("/send");
  await page.getByTestId(`send-asset-${baseAsset.id}`).click();

  await choose(page, "username");
  await fill(page, recipient, "0.5");

  await review(page);

  await expect(page.getByTestId("confirm-payment")).toBeVisible({
    timeout: 30_000,
  });

  const summary = page.getByTestId("payment-summary");

  await expect(summary).toBeVisible();
  await expect(summary).toHaveAttribute("data-username", recipient);
  await expect(summary).toHaveAttribute("data-asset", baseAsset.code);
  await expect(summary).toHaveAttribute("data-amount", "0.5");

  const approved = page.waitForResponse(
    (response) =>
      response.url().includes(serverFunction) &&
      (response.request().postData()?.includes('"signature"') ?? false),
  );

  await page.getByTestId("confirm-payment").click();
  await approved;
  await expect(page).toHaveURL(/transfer=/);
  await page.reload();

  await expect(page.getByTestId("send-outcome")).toHaveAttribute(
    "data-outcome",
    "Settled",
    {
      timeout: 90_000,
    },
  );

  await page.getByTestId("result-home").click();
  await expect(page).toHaveURL("/home");

  await page.goto("/send");
  await page.getByTestId(`send-asset-${baseAsset.id}`).click();
  await choose(page, "username");
  await fill(page, recipient, "5");
  await review(page);

  await expect(page.getByRole("textbox")).toHaveAttribute(
    "aria-invalid",
    "true",
    { timeout: 30_000 },
  );
  await expect(page.getByRole("textbox")).toBeFocused();

  const exchange = newWalletAddress();

  await page.route(`**${serverFunction}**`, (route) =>
    route.request().postData()?.includes(exchange)
      ? route.fulfill({
          json: {
            result: Schema.encodeSync(TransferStep)(
              new ExternalMemoRequired({
                address: Schema.decodeSync(AccountAddress)(exchange),
                exchange: "Exchange de prueba",
                source: "https://example.com/deposits",
              }),
            ),
          },
        })
      : route.continue(),
  );

  await page.getByTestId("change-recipient").click();
  await page.getByTestId("change-destination").click();
  await choose(page, "address");
  await fill(page, exchange, "0.1");
  await expect(page.getByTestId("edit-memo")).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("textbox")).toHaveCount(0);
  await review(page);

  await expect(page.getByRole("dialog").getByRole("textbox")).toHaveAttribute(
    "aria-invalid",
    "true",
    { timeout: 30_000 },
  );
  await expect(page.getByRole("dialog").getByRole("textbox")).toBeFocused();
  await page.getByRole("dialog").getByRole("textbox").fill("4521");
  await page.getByTestId("save-memo").click();
  await expect(page.getByTestId("edit-memo")).toBeVisible();

  await page.getByTestId("change-recipient").click();
  await page.getByTestId("change-destination").click();
  await choose(page, "address");
  await fill(page, newWalletAddress(), "0.1");
  await review(page);

  await page.getByTestId("offer-link").click({ timeout: 30_000 });

  const linkReview = page.getByTestId("link-review");

  await expect(linkReview).toBeVisible({ timeout: 30_000 });
  await expect(linkReview).toHaveAttribute("data-amount", "0.1");
});
