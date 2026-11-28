import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

import {
  createPostgres,
  devVarsPath,
  isPortListening,
  linkMainCheckoutDevVars,
  postgresName,
  postgresPort,
  postgresState,
  repoRoot,
  startPostgres,
  waitForPostgres,
} from "./local-environment.mjs";

const humanCheckTestKeys = {
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
};

const fail = (message) => {
  process.stderr.write(`setup: ${message}\n`);
  process.exit(1);
};

const report = (message) => process.stdout.write(`setup: ${message}\n`);

const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });

  if (result.status !== 0) fail(`\`${command} ${args.join(" ")}\` failed.`);
};

const versionParts = (version) =>
  version
    .replace(/^[^\d]*/, "")
    .split(".")
    .map(Number);

const isAtLeast = (version, minimum) => {
  const actual = versionParts(version);
  const required = versionParts(minimum);
  const differing = required.findIndex((part, index) => actual[index] !== part);

  return differing === -1 || actual[differing] > required[differing];
};

const checkRuntimes = () => {
  const manifest = JSON.parse(
    readFileSync(join(repoRoot, "package.json"), "utf8"),
  );

  const pinnedBun = manifest.packageManager.replace("bun@", "");
  const minimumNode = manifest.engines.node.replace(">=", "");
  const node = spawnSync("node", ["--version"], { encoding: "utf8" });

  if (node.error?.code === "ENOENT")
    fail(`Node ${minimumNode} or newer is required and is not installed.`);

  if (!isAtLeast(node.stdout.trim(), minimumNode))
    fail(
      `Node ${minimumNode} or newer is required; found ${node.stdout.trim()}.`,
    );

  if (process.versions.bun !== pinnedBun)
    report(
      `warning: this repository pins Bun ${pinnedBun}; you are running ${process.versions.bun}. Run \`bun upgrade --version ${pinnedBun}\` if anything misbehaves.`,
    );
};

const ensurePostgres = async () => {
  const state = postgresState();

  if (state === "missing") {
    if (isPortListening(postgresPort))
      fail(
        `port ${postgresPort} is taken by another process. Free it and retry.`,
      );

    report(`creating the ${postgresName} container.`);
    createPostgres();
    report(`created the ${postgresName} container.`);
  }

  if (state === "stopped") {
    startPostgres();
    report(`started the ${postgresName} container.`);
  }

  await waitForPostgres();
  report(`${postgresName} accepts connections.`);
};

const readDevVars = () => {
  if (!existsSync(devVarsPath)) return new Map();

  return new Map(
    readFileSync(devVarsPath, "utf8")
      .split("\n")
      .map((line) => line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/))
      .filter((match) => match !== null)
      .map(([, key, value]) => [
        key,
        value.trim().replace(/^(["'])(.*)\1$/, "$2"),
      ]),
  );
};

const sponsorAddressOf = (devnet, secret) => {
  try {
    return devnet.sponsorAddressOf(secret);
  } catch {
    return fail(
      "SPONSOR_SECRET in apps/web/.dev.vars is not a base58 Solana keypair. Remove the line and run setup again to create a new one.",
    );
  }
};

const askProviderRpcUrl = async () => {
  if (process.env.SOLANA_RPC_URL) return process.env.SOLANA_RPC_URL;

  if (!process.stdin.isTTY) return "";

  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await prompt.question(
    "setup: Solana devnet RPC URL from a provider such as Helius (leave empty to set it later): ",
  );

  prompt.close();

  return answer.trim();
};

const warnAboutRpcUrl = (devnet, rpcUrl) => {
  if (rpcUrl !== "" && rpcUrl !== devnet.publicDevnetRpcUrl) return;

  report(
    `warning: SOLANA_RPC_URL in apps/web/.dev.vars is ${rpcUrl === "" ? "empty" : "the public devnet RPC, which refuses the dev server's requests"}. Set it to a provider devnet RPC URL, such as one from https://dashboard.helius.dev, before \`bun run dev\`.`,
  );
};

const faucetHint = (address) =>
  `fund the sponsor ${address} with devnet SOL at https://faucet.solana.com, then run setup again.`;

const airdropped = async (devnet, rpcUrl, address) => {
  try {
    await devnet.airdrop(rpcUrl, address);
    report(`airdropped devnet SOL to the sponsor ${address}.`);

    return true;
  } catch (error) {
    report(`warning: the devnet airdrop failed (${error.message}).`);

    return false;
  }
};

const prepareSponsor = async (devnet, rpcUrl, secret, address) => {
  const funded =
    (await devnet.isFunded(rpcUrl, address)) ||
    (await airdropped(devnet, rpcUrl, address));

  if (!funded) {
    report(
      `warning: skipped opening the sandbox payout partner because the sponsor has no SOL; ${faucetHint(address)}`,
    );

    return;
  }

  if (await devnet.openSandboxPartner(rpcUrl, secret))
    report("the sponsor opened the sandbox payout partner's USDC account.");
};

const appendDevVars = (existing, entries) => {
  if (entries.length === 0) {
    report("apps/web/.dev.vars already has every key.");

    return;
  }

  const separator =
    existing.size > 0 && !readFileSync(devVarsPath, "utf8").endsWith("\n")
      ? "\n"
      : "";

  appendFileSync(
    devVarsPath,
    `${separator}${entries.map(([key, value]) => `${key}=${value}\n`).join("")}`,
    { mode: 0o600 },
  );
  chmodSync(devVarsPath, 0o600);
  report(
    `added ${entries.map(([key]) => key).join(", ")} to apps/web/.dev.vars.`,
  );
};

const ensureDevVars = async () => {
  if (!existsSync(devVarsPath) && linkMainCheckoutDevVars())
    report("linked apps/web/.dev.vars to the main checkout.");

  const devnet = await import("@workspace/wallet/devnet");
  const existing = readDevVars();
  const rpcUrl = existing.get("SOLANA_RPC_URL") ?? (await askProviderRpcUrl());
  const existingSecret = existing.get("SPONSOR_SECRET");
  const sponsorSecret = existingSecret ?? devnet.newSponsorSecret();
  const sponsorAddress = sponsorAddressOf(devnet, sponsorSecret);

  appendDevVars(
    existing,
    [
      ["SOLANA_RPC_URL", rpcUrl],
      ["SPONSOR_SECRET", sponsorSecret],
      ["SESSION_SECRET", randomBytes(32).toString("base64url")],
      ...Object.entries(humanCheckTestKeys),
    ].filter(([key]) => !existing.has(key)),
  );
  report(
    existingSecret === undefined
      ? `created the sponsor ${sponsorAddress}.`
      : `the sponsor is ${sponsorAddress}.`,
  );

  warnAboutRpcUrl(devnet, rpcUrl);

  await prepareSponsor(
    devnet,
    rpcUrl || devnet.publicDevnetRpcUrl,
    sponsorSecret,
    sponsorAddress,
  );
};

const flags = new Set(process.argv.slice(2));

try {
  checkRuntimes();
  run("bun", ["install"], repoRoot);
  await ensurePostgres();
  run("bun", ["run", "db:migrate:local"], repoRoot);
  await ensureDevVars();

  if (flags.has("--e2e"))
    run(
      "bunx",
      ["playwright", "install", "chromium"],
      join(repoRoot, "apps/web"),
    );
} catch (error) {
  fail(error.message);
}

report(
  "done. Start the app with `bun run dev` and open http://localhost:3000.",
);
