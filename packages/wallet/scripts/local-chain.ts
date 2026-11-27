import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import { TOKEN_PROGRAM_ADDRESS, getMintEncoder } from "@solana-program/token";
import { getBase16Decoder, none } from "@solana/kit";
import {
  ORCHID_LINKS_PROGRAM_ADDRESS,
  USDC_MINT_ADDRESS,
} from "@workspace/orchid-links";
import { epochAt, network } from "../src/record-network";
import { sandboxPartnerOf, sponsorAddressOf } from "./devnet";

export const recordNetwork = network;

export const recordEpochAt = epochAt;

const port = 18899;

export const localChainUrl = `http://127.0.0.1:${port}`;

const localSeed = new Uint8Array(32).fill(9);

export const localSponsorSecret = base58.encode(
  new Uint8Array([...localSeed, ...ed25519.getPublicKey(localSeed)]),
);

export const localSponsor = sponsorAddressOf(localSponsorSecret);

const programPath = new URL(
  "../../../target/deploy/orchid_links.so",
  import.meta.url,
);

const base16Decoder = getBase16Decoder();

const healthAttempts = 100;

const pause = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const call = async (method: string, params: ReadonlyArray<unknown>) => {
  const response = await fetch(localChainUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

  const reply: { readonly error?: { readonly message: string } } =
    await response.json();

  if (reply.error !== undefined)
    throw new Error(`Surfnet ${method} failed: ${reply.error.message}`);
};

const healthy = async () => {
  for (let attempt = 0; attempt < healthAttempts; attempt += 1) {
    const reachable = await call("getHealth", []).then(
      () => true,
      () => false,
    );

    if (reachable) return;

    await pause(100);
  }

  throw new Error("Surfnet did not become healthy");
};

const setUsdcAccount = (
  owner: string,
  update: Readonly<Record<string, number | string>>,
) =>
  call("surfnet_setTokenAccount", [
    owner,
    USDC_MINT_ADDRESS,
    update,
    TOKEN_PROGRAM_ADDRESS,
  ]);

export const newWalletAddress = () =>
  base58.encode(ed25519.getPublicKey(ed25519.utils.randomSecretKey()));

export const openUsdcAccount = (owner: string) =>
  setUsdcAccount(owner, { amount: 0, closeAuthority: localSponsor });

export const fundUsdc = (owner: string, units: number) =>
  setUsdcAccount(owner, { amount: units });

export const startLocalChain = async (): Promise<ChildProcess> => {
  const chain = spawn(
    "surfpool",
    [
      "start",
      "--offline",
      "--ci",
      "--no-deploy",
      "--airdrop-amount",
      "0",
      "--port",
      String(port),
      "--ws-port",
      String(port + 1),
      "--log-level",
      "none",
    ],
    { stdio: "ignore" },
  );

  try {
    await healthy();

    await call("surfnet_writeProgram", [
      ORCHID_LINKS_PROGRAM_ADDRESS,
      base16Decoder.decode(await readFile(programPath)),
      0,
    ]);

    await call("surfnet_setAccount", [
      USDC_MINT_ADDRESS,
      {
        owner: TOKEN_PROGRAM_ADDRESS,
        data: base16Decoder.decode(
          getMintEncoder().encode({
            mintAuthority: none(),
            supply: 1_000_000_000_000n,
            decimals: 6,
            isInitialized: true,
            freezeAuthority: none(),
          }),
        ),
        lamports: 10_000_000,
        executable: false,
      },
    ]);

    await call("surfnet_setAccount", [
      localSponsor,
      { lamports: 100_000_000_000 },
    ]);
    await setUsdcAccount(sandboxPartnerOf(localSponsorSecret), { amount: 0 });
  } catch (failure) {
    await stopLocalChain(chain);

    throw failure;
  }

  return chain;
};

export const stopLocalChain = async (chain: ChildProcess) => {
  if (chain.exitCode !== null) return;

  const exited = once(chain, "exit");

  chain.kill("SIGKILL");
  await exited;
};
