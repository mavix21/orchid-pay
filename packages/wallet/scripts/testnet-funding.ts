import {
  Asset,
  Horizon,
  Keypair,
  NotFoundError,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { channelKeypairs } from "../src/stellar/channel-pool.server";
import { sandboxPartnerKeypair } from "../src/stellar/sandbox-partner";
import { networkPassphrase, usdc } from "../src/stellar/network";

export { usdc };

const testnetRequestTimeout = 20_000;

export const horizon = new Horizon.Server(
  "https://horizon-testnet.stellar.org",
);

horizon.httpClient.defaults.timeout = testnetRequestTimeout;

const friendbotAttempts = 3;

const friendbotBackoff = 5_000;

const pause = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const requestFunding = (address: string) =>
  fetch(`https://friendbot.stellar.org/?addr=${address}`, {
    signal: AbortSignal.timeout(testnetRequestTimeout),
  }).then(
    (response) => `HTTP ${response.status}`,
    () => "no response",
  );

const visibleAccount = async (address: string) => {
  try {
    return await horizon.loadAccount(address);
  } catch (error) {
    if (error instanceof NotFoundError) return undefined;

    throw new Error(`Horizon could not load ${address}`, { cause: error });
  }
};

const fundWithin = async (
  address: string,
  attemptsLeft: number,
): Promise<Horizon.AccountResponse> => {
  const outcome = await requestFunding(address);
  const account = await visibleAccount(address);

  if (account !== undefined) return account;

  if (attemptsLeft === 1)
    throw new Error(`Friendbot did not fund ${address}: ${outcome}`);

  await pause(friendbotBackoff);

  return fundWithin(address, attemptsLeft - 1);
};

export const fundWithFriendbot = (address: string) =>
  fundWithin(address, friendbotAttempts);

export const fundedTestnetKeypair = async () => {
  const keypair = Keypair.random();

  await fundWithFriendbot(keypair.publicKey());

  return keypair;
};

export const testnetAddress = (secret: string) =>
  Keypair.fromSecret(secret).publicKey();

export const isOpenOnTestnet = async (address: string) =>
  (await visibleAccount(address)) !== undefined;

export const fundWithUsdc = async (address: string, amount: string) => {
  const funder = Keypair.random();

  const source = await fundWithFriendbot(funder.publicKey());

  const payment = new TransactionBuilder(source, {
    fee: "10000",
    networkPassphrase,
  })
    .addOperation(
      Operation.pathPaymentStrictReceive({
        sendAsset: Asset.native(),
        sendMax: "100",
        destination: address,
        destAsset: usdc,
        destAmount: amount,
        path: [],
      }),
    )
    .setTimeout(60)
    .build();

  payment.sign(funder);

  return horizon.submitTransaction(payment);
};

export const openChannels = async (
  sponsorSecret: string,
  feePayerSecret: string,
) => {
  const sponsor = Keypair.fromSecret(sponsorSecret);
  const channels = channelKeypairs(Keypair.fromSecret(feePayerSecret));

  const opened = await Promise.all(
    channels.map((channel) => isOpenOnTestnet(channel.publicKey())),
  );

  const missing = channels.filter((_, index) => !opened[index]);

  if (missing.length === 0) return 0;

  const opening = new TransactionBuilder(
    await horizon.loadAccount(sponsor.publicKey()),
    { fee: "10000", networkPassphrase },
  );

  for (const channel of missing)
    opening
      .addOperation(
        Operation.beginSponsoringFutureReserves({
          sponsoredId: channel.publicKey(),
        }),
      )
      .addOperation(
        Operation.createAccount({
          destination: channel.publicKey(),
          startingBalance: "0",
        }),
      )
      .addOperation(
        Operation.endSponsoringFutureReserves({ source: channel.publicKey() }),
      );

  const transaction = opening.setTimeout(60).build();

  transaction.sign(sponsor, ...missing);

  await horizon.submitTransaction(transaction);

  return missing.length;
};

export const openSandboxPartner = async (
  sponsorSecret: string,
  feePayerSecret: string,
) => {
  const sponsor = Keypair.fromSecret(sponsorSecret);
  const partner = sandboxPartnerKeypair(Keypair.fromSecret(feePayerSecret));

  if (await isOpenOnTestnet(partner.publicKey())) return false;

  const opening = new TransactionBuilder(
    await horizon.loadAccount(sponsor.publicKey()),
    { fee: "10000", networkPassphrase },
  )
    .addOperation(
      Operation.beginSponsoringFutureReserves({
        sponsoredId: partner.publicKey(),
      }),
    )
    .addOperation(
      Operation.createAccount({
        destination: partner.publicKey(),
        startingBalance: "0",
      }),
    )
    .addOperation(
      Operation.changeTrust({ asset: usdc, source: partner.publicKey() }),
    )
    .addOperation(
      Operation.endSponsoringFutureReserves({ source: partner.publicKey() }),
    )
    .setTimeout(60)
    .build();

  opening.sign(sponsor, partner);

  await horizon.submitTransaction(opening);

  return true;
};
