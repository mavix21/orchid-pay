import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

const testnetAccounts = [
  { key: "RESERVE_SPONSOR_SECRET", role: "reserve sponsor" },
  { key: "FEE_PAYER_SECRET", role: "fee payer" },
];

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

const testnetAddressOf = (testnet, key, secret) => {
  try {
    return testnet.testnetAddress(secret);
  } catch {
    return fail(
      `${key} in apps/web/.dev.vars is not a valid Stellar secret key. Remove the line and run setup again to create a new one.`,
    );
  }
};

const ensureTestnetAccount = async (testnet, existing, { key, role }) => {
  const secret = existing.get(key);

  if (secret === undefined) {
    const keypair = await testnet.fundedTestnetKeypair();

    report(`created and funded the ${role} ${keypair.publicKey()}.`);

    return [[key, keypair.secret()]];
  }

  const address = testnetAddressOf(testnet, key, secret);

  if (await testnet.isOpenOnTestnet(address)) {
    report(`the ${role} ${address} is open on testnet.`);

    return [];
  }

  await testnet.fundWithFriendbot(address);
  report(`funded the ${role} ${address} again after a testnet reset.`);

  return [];
};

const ensureDevVars = async () => {
  if (!existsSync(devVarsPath) && linkMainCheckoutDevVars())
    report("linked apps/web/.dev.vars to the main checkout.");

  const testnet = await import("@workspace/wallet/testnet");
  const existing = readDevVars();
  const funded = [];

  for (const account of testnetAccounts)
    funded.push(...(await ensureTestnetAccount(testnet, existing, account)));

  const secrets = new Map([...existing, ...funded]);

  const channels = await testnet.openChannels(
    secrets.get("RESERVE_SPONSOR_SECRET"),
    secrets.get("FEE_PAYER_SECRET"),
  );

  if (channels > 0)
    report(`the reserve sponsor opened ${channels} channel accounts.`);

  if (
    await testnet.openSandboxPartner(
      secrets.get("RESERVE_SPONSOR_SECRET"),
      secrets.get("FEE_PAYER_SECRET"),
    )
  )
    report("the reserve sponsor opened the sandbox payout partner.");

  const generated = [
    ...funded,
    ["SESSION_SECRET", randomBytes(32).toString("base64url")],
    ...Object.entries(humanCheckTestKeys),
  ].filter(([key]) => !existing.has(key));

  if (generated.length === 0) {
    report("apps/web/.dev.vars already has every key.");

    return;
  }

  const separator =
    existing.size > 0 && !readFileSync(devVarsPath, "utf8").endsWith("\n")
      ? "\n"
      : "";

  appendFileSync(
    devVarsPath,
    `${separator}${generated.map(([key, value]) => `${key}=${value}\n`).join("")}`,
    { mode: 0o600 },
  );
  chmodSync(devVarsPath, 0o600);
  report(
    `added ${generated.map(([key]) => key).join(", ")} to apps/web/.dev.vars.`,
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
