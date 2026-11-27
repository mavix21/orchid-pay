import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  devVarsPath,
  isPortListening,
  linkMainCheckoutDevVars,
  postgresName,
  postgresState,
  repoRoot,
  startPostgres,
  waitForPostgres,
} from "./local-environment.mjs";

const devPort = 3000;
const servePort = 8443;
const devTarget = `http://localhost:${devPort}`;
const pidFile = join(tmpdir(), "orchid-dev-phone.pid");
const readyTimeoutMs = 120_000;
const shutDownGraceMs = 10_000;
const setupHint = 'One-time setup: see "Test from your phone" in README.md.';

const fail = (message) => {
  process.stderr.write(`dev:phone: ${message}\n`);
  process.exit(1);
};

const tailscale = (...args) => {
  const result = spawnSync("tailscale", args, { encoding: "utf8" });

  if (result.error?.code === "ENOENT")
    fail(`the tailscale CLI is not installed. ${setupHint}`);

  return result;
};

const parseJson = (text, source) => {
  try {
    return JSON.parse(text);
  } catch {
    return fail(`could not read the output of ${source}.`);
  }
};

const readTailnetHost = () => {
  const result = tailscale("status", "--json");

  if (!result.stdout)
    fail(`tailscale is not running. Start the Tailscale app. ${setupHint}`);

  const status = parseJson(result.stdout, "tailscale status --json");

  if (status.BackendState !== "Running")
    fail(
      `Tailscale is ${status.BackendState}. Open the Tailscale app and sign in. ${setupHint}`,
    );

  if (!status.CertDomains?.length)
    fail(`HTTPS certificates are not enabled for this tailnet. ${setupHint}`);

  return status.Self.DNSName.replace(/\.$/, "");
};

const readServeStatus = () => {
  const result = tailscale("serve", "status", "--json");

  if (result.status !== 0)
    fail(`could not read the Tailscale serve status.\n${result.stderr}`);

  return parseJson(result.stdout, "tailscale serve status --json");
};

const servedHostPort = (host) => `${host}:${servePort}`;

const readRootHandler = (host) =>
  readServeStatus().Web?.[servedHostPort(host)]?.Handlers?.["/"];

const isAnyFunnelOpen = () => {
  const status = readServeStatus();

  return [status, ...Object.values(status.Foreground ?? {})].some((config) =>
    Object.values(config.AllowFunnel ?? {}).some((open) => open === true),
  );
};

const turnServeOff = (host) => {
  if (readRootHandler(host)?.Proxy !== devTarget) return;

  const result = tailscale(
    "serve",
    `--https=${servePort}`,
    "--set-path=/",
    "off",
  );

  if (result.status !== 0)
    process.stderr.write(
      `dev:phone: could not remove the Tailscale serve entry. Run \`tailscale serve --https=${servePort} --set-path=/ off\`.\n${result.stderr}`,
    );
};

const publicUrl = (host) => `https://${host}:${servePort}`;

const processCommand = (pid) =>
  spawnSync("ps", ["-p", String(pid), "-o", "command="], {
    encoding: "utf8",
  }).stdout;

const isProcessNamed = (pid, name) =>
  Number.isInteger(pid) && processCommand(pid).includes(name);

const readState = () => {
  try {
    return JSON.parse(readFileSync(pidFile, "utf8"));
  } catch {
    return undefined;
  }
};

const readRunningLauncher = () => {
  const state = readState();

  return state && isProcessNamed(state.launcher, "dev-phone.mjs")
    ? state.launcher
    : undefined;
};

const reapStale = () => {
  if (readRunningLauncher() !== undefined) return false;

  const state = readState();

  if (state && isProcessNamed(state.dev, "run dev --ui=stream")) {
    try {
      process.kill(-state.dev, "SIGTERM");
    } catch {
      process.kill(state.dev, "SIGTERM");
    }
  }

  const existed = existsSync(pidFile);

  rmSync(pidFile, { force: true });

  return existed;
};

const writeState = (state) => {
  const pending = `${pidFile}.${process.pid}`;

  writeFileSync(pending, JSON.stringify(state));
  renameSync(pending, pidFile);
};

const claimState = () => {
  try {
    writeFileSync(pidFile, JSON.stringify({ launcher: process.pid }), {
      flag: "wx",
    });

    return true;
  } catch {
    return false;
  }
};

const assertNotPublic = () => {
  if (isAnyFunnelOpen())
    fail(
      "Tailscale Funnel is enabled on this machine, which could expose the dev server publicly. Turn every funnel off (`tailscale funnel status`) and retry.",
    );
};

const serveOnTailnet = (host) => {
  assertNotPublic();

  const root = readRootHandler(host);

  if (root !== undefined && root.Proxy !== devTarget)
    fail(
      `port ${servePort} on this machine already serves something else at /. Free it with \`tailscale serve --https=${servePort} off\` and retry.`,
    );

  const result = tailscale(
    "serve",
    "--bg",
    "--yes",
    `--https=${servePort}`,
    "--set-path=/",
    devTarget,
  );

  if (result.status !== 0)
    fail(`tailscale serve failed.\n${result.stderr}${result.stdout}`);

  if (isAnyFunnelOpen()) {
    turnServeOff(host);
    fail("Tailscale Funnel is enabled; refusing to continue.");
  }
};

const waitUntilReady = async (isAlive) => {
  const deadline = Date.now() + readyTimeoutMs;

  while (Date.now() < deadline && isAlive()) {
    const ready = await fetch(devTarget).then(
      () => true,
      () => false,
    );

    if (ready) return true;

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return false;
};

const ensureDevVars = () => {
  if (existsSync(devVarsPath)) return;

  if (!linkMainCheckoutDevVars())
    fail(
      "apps/web/.dev.vars is missing, so the wallet has no sponsor keys. Run `bun run setup`.",
    );

  process.stdout.write(
    "dev:phone linked apps/web/.dev.vars to the main checkout.\n",
  );
};

const ensurePostgres = async () => {
  try {
    const state = postgresState();

    if (state === "missing")
      fail(
        `the ${postgresName} container does not exist. Run \`bun run setup\`.`,
      );

    if (state === "stopped") {
      startPostgres();
      process.stdout.write(
        `dev:phone started the ${postgresName} container.\n`,
      );
    }

    await waitForPostgres();
  } catch (error) {
    fail(error.message);
  }

  process.stdout.write(`${postgresName} accepts connections.\n`);
};

const start = async () => {
  ensureDevVars();
  await ensurePostgres();

  const host = readTailnetHost();
  assertNotPublic();

  if (!claimState()) {
    const runningLauncher = readRunningLauncher();

    if (runningLauncher !== undefined) {
      if (readState()?.dev === undefined)
        fail("another dev:phone is starting. Retry in a moment.");

      serveOnTailnet(host);
      process.stdout.write(
        `dev:phone is already running (pid ${runningLauncher}).\n`,
      );
      process.stdout.write(`${publicUrl(host)}\n`);

      return;
    }

    reapStale();

    if (!claimState())
      fail("another dev:phone is starting. Retry in a moment.");
  }

  if (isPortListening(devPort)) {
    rmSync(pidFile, { force: true });
    fail(
      `port ${devPort} is in use. Stop the process using it (a plain \`bun run dev\` included) and retry.`,
    );
  }

  const origin = publicUrl(host);

  const dev = spawn("bun", ["run", "dev", "--ui=stream"], {
    cwd: repoRoot,
    detached: true,
    stdio: "inherit",
    env: { ...process.env, ORCHID_PHONE_ORIGIN: origin },
  });

  let devExited = false;
  let stopping = false;

  writeState({ launcher: process.pid, dev: dev.pid });

  const signalDev = (signal) => {
    if (devExited) return;

    try {
      process.kill(-dev.pid, signal);
    } catch {
      dev.kill(signal);
    }
  };

  const shutDown = () => {
    if (stopping) return;

    stopping = true;
    signalDev("SIGTERM");
    setTimeout(() => {
      signalDev("SIGKILL");
      process.exit(0);
    }, shutDownGraceMs).unref();
  };

  process.on("exit", () => {
    signalDev("SIGKILL");
    rmSync(pidFile, { force: true });
    turnServeOff(host);
  });

  dev.on("exit", (code) => {
    devExited = true;
    process.exit(stopping ? 0 : (code ?? 1));
  });

  process.on("SIGINT", shutDown);
  process.on("SIGTERM", shutDown);
  process.on("SIGHUP", shutDown);

  if (!(await waitUntilReady(() => !devExited)))
    fail("the dev server did not become ready.");

  serveOnTailnet(host);
  process.stdout.write(`${origin}\n`);
};

const stop = () => {
  const runningLauncher = readRunningLauncher();

  if (runningLauncher !== undefined) {
    process.kill(runningLauncher, "SIGTERM");
    process.stdout.write("dev:phone is stopping.\n");

    return;
  }

  if (reapStale()) turnServeOff(readTailnetHost());

  process.stdout.write("dev:phone is not running.\n");
};

const commands = { start, stop };
const command = commands[process.argv[2] ?? "start"];

if (!command) fail("usage: bun tools/dev-phone.mjs [start|stop]");

await command();
