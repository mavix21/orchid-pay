import {
  type APIRequestContext,
  type Page,
  expect,
  test,
} from "@playwright/test";
import { AccountAddress } from "@workspace/wallet";
import { fundUsdc } from "@workspace/wallet/local-chain";
import * as Schema from "effect/Schema";

import {
  addAuthenticator,
  countPasskeyPrompts,
  freshUsername,
  openWallet,
  storedWalletAddress,
  submitButton,
  usernameInput,
  walletActive,
} from "./device";

const recordShares = async (page: Page) => {
  const shared: Array<string> = [];

  await page.exposeFunction("recordShare", (text: string) => {
    shared.push(text);
  });
  await page.addInitScript({
    content: `Object.defineProperty(navigator, "share", { configurable: true, value: (data) => window.recordShare(data.text) });`,
  });

  return shared;
};

const requestLink = async (
  page: Page,
  shared: ReadonlyArray<string>,
  amount: string,
) => {
  await page.getByTestId("open-request").click();
  await page.getByTestId("amount-input").fill(amount);
  await page.getByTestId("create-request").click();
  await page.getByTestId("share-link").click();
  await expect.poll(() => shared).toHaveLength(1);

  const [message = ""] = shared;

  return new URL(message.split("\n\n").at(-1) ?? "");
};

const servedPreview = async (request: APIRequestContext, url: string) => {
  const response = await request.get(url);
  const html = await response.text();

  const meta = (key: string) =>
    new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)"`).exec(
      html,
    )?.[1] ?? "";

  return {
    html,
    title: meta("og:title"),
    description: meta("og:description"),
    robots: meta("robots"),
    image: meta("og:image"),
  };
};

test("a payment request stays public and shows its cancellation", async ({
  page,
  browser,
}) => {
  const shared = await recordShares(page);
  const prompts = await countPasskeyPrompts(page);
  const username = freshUsername();
  const address = await openWallet(page, username);

  await page.getByTestId("open-request").click();
  await page.getByTestId("amount-input").fill("20");
  await page.getByTestId("request-note").fill("  Cena del viernes ");
  await page.getByTestId("create-request").click();
  await page.getByTestId("share-link").click();
  await expect.poll(() => shared).toHaveLength(1);

  const [message = ""] = shared;
  const link = new URL(message.split("\n\n").at(-1) ?? "");

  expect(link.pathname).toMatch(/^\/pay\/[1-9A-HJ-NP-Za-km-z]{10}$/u);

  const visitor = await browser.newContext();
  const publicPage = await visitor.newPage();

  await publicPage.goto(link.href);

  const request = publicPage.getByTestId("payment-request");

  await expect(request).toHaveAttribute("data-state", "PaymentRequestOpen");
  await expect(request).toHaveAttribute("data-requester", username);
  await expect(publicPage.getByTestId("payment-request-avatar")).toBeVisible();
  await expect(
    publicPage.getByTestId("payment-request-amount"),
  ).toHaveAttribute("data-amount", "20 USDC");
  await expect(publicPage.getByTestId("payment-request-note")).toHaveAttribute(
    "data-note",
    "Cena del viernes",
  );

  const openPreview = await servedPreview(visitor.request, link.href);

  expect(openPreview.title).toContain(username);
  expect(openPreview.title).toContain("20 USDC");
  expect(openPreview.robots).toContain("noindex");
  expect(openPreview.image).toBe(new URL("/og-payment-request.png", link).href);
  expect(openPreview.html).not.toContain(address);

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("request-share")).toBeHidden();
  await page.getByTestId("view-links").click();

  const row = page.getByTestId("open-request-row");

  await expect(row).toHaveAttribute(
    "data-request",
    link.pathname.slice("/pay/".length),
  );

  const promptsBeforeResharing = await prompts();

  await page.getByTestId("reshare-request").click();
  await page.getByTestId("share-link").click();
  await expect.poll(() => shared).toEqual([message, message]);
  expect(await prompts()).toEqual(promptsBeforeResharing);

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("request-share")).toBeHidden();
  await page.getByTestId("cancel-request").click();
  await expect(row).toHaveCount(0);

  await publicPage.reload();
  await expect(request).toHaveAttribute(
    "data-state",
    "PaymentRequestCancelled",
  );

  const cancelledPreview = await servedPreview(visitor.request, link.href);

  expect(cancelledPreview.title).toContain(username);
  expect(cancelledPreview.title).not.toBe(openPreview.title);
  expect(cancelledPreview.description).not.toBe(openPreview.description);

  await visitor.close();
});

test("a payer without a wallet creates one on the request page and pays it", async ({
  page,
  browser,
}) => {
  test.setTimeout(420_000);

  const shared = await recordShares(page);

  await openWallet(page, freshUsername());

  const link = await requestLink(page, shared, "0.5");
  const requestId = link.pathname.slice("/pay/".length);

  const payerContext = await browser.newContext(test.info().project.use);
  const payer = await payerContext.newPage();
  const payerUsername = freshUsername();

  await addAuthenticator(payer, true);
  await payer.goto(link.href);
  await payer.getByTestId("pay-request").click();
  await payer.getByTestId("pay-create-account").click();
  await usernameInput(payer).fill(payerUsername);
  await submitButton(payer).click();
  await expect(payer.getByTestId("enrollment-step")).toHaveAttribute(
    "data-stage",
    "activate",
    { timeout: 30_000 },
  );
  await payer.getByTestId("enrollment-continue").click();

  const outcome = payer.getByTestId("send-outcome");

  await expect(outcome).toHaveAttribute("data-outcome", "InsufficientBalance", {
    timeout: 120_000,
  });
  await expect(payer).toHaveURL(link.href);

  const address = Schema.decodeSync(AccountAddress)(
    await storedWalletAddress(payer),
  );

  await expect
    .poll(() => walletActive(address), { timeout: 120_000 })
    .toBe(true);
  await fundUsdc(address, 1_000_000);
  await payer.getByTestId("result-again").click();

  const summary = payer.getByTestId("payment-summary");

  await expect(summary).toHaveAttribute("data-amount", "0.5", {
    timeout: 30_000,
  });
  await payer.getByTestId("confirm-payment").click();

  const request = payer.getByTestId("payment-request");

  await expect(request).toHaveAttribute("data-state", "PaymentRequestPaid", {
    timeout: 120_000,
  });
  await expect(payer.getByTestId("pay-request")).toHaveCount(0);
  await payer.reload();
  await expect(request).toHaveAttribute("data-state", "PaymentRequestPaid");
  await expect(payer.getByTestId("pay-request")).toHaveCount(0);
  await payerContext.close();

  await page.goto("/activity");

  const paid = page.locator(
    `[data-testid="activity-row"][data-paid-request="${requestId}"]`,
  );

  await expect(paid).toHaveAttribute("data-entry", "ReceivedActivity");
  await expect(paid).toHaveAttribute("data-counterparty", payerUsername);
});
