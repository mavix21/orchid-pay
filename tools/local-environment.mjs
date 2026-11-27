import { spawnSync } from "node:child_process";
import { existsSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";

export const repoRoot = new URL("../", import.meta.url).pathname;
export const devVarsPath = join(repoRoot, "apps/web/.dev.vars");
export const postgresName = "orchid-postgres";
export const postgresPort = 55432;

const postgresReadyTimeoutMs = 30_000;

const docker = (...args) => {
  const result = spawnSync("docker", args, { encoding: "utf8" });

  if (result.error?.code === "ENOENT")
    throw new Error(
      "the docker CLI is not installed. Install Docker Desktop and retry.",
    );

  return result;
};

export const postgresState = () => {
  const inspected = docker(
    "inspect",
    "--format",
    "{{.State.Running}}",
    postgresName,
  );

  if (inspected.status === 0)
    return inspected.stdout.trim() === "true" ? "running" : "stopped";

  if (/no such object/i.test(inspected.stderr)) return "missing";

  throw new Error(
    `docker is not available. Start Docker Desktop.\n${inspected.stderr}`,
  );
};

export const isPortListening = (port) =>
  spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], {
    encoding: "utf8",
  }).stdout.trim() !== "";

export const createPostgres = () => {
  const created = docker(
    "run",
    "-d",
    "--name",
    postgresName,
    "-e",
    "POSTGRES_USER=orchid",
    "-e",
    "POSTGRES_PASSWORD=orchid-local",
    "-e",
    "POSTGRES_DB=orchid",
    "-p",
    `127.0.0.1:${postgresPort}:5432`,
    "-v",
    "orchid-postgres-data:/var/lib/postgresql/data",
    "postgres:17",
  );

  if (created.status !== 0)
    throw new Error(`could not create ${postgresName}.\n${created.stderr}`);
};

export const startPostgres = () => {
  const started = docker("start", postgresName);

  if (started.status !== 0)
    throw new Error(`could not start ${postgresName}.\n${started.stderr}`);
};

export const waitForPostgres = async () => {
  const deadline = Date.now() + postgresReadyTimeoutMs;

  while (Date.now() < deadline) {
    const ready = docker(
      "exec",
      postgresName,
      "pg_isready",
      "-q",
      "-h",
      "127.0.0.1",
      "-U",
      "orchid",
      "-d",
      "orchid",
    );

    if (ready.status === 0) return;

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`${postgresName} did not accept connections in time.`);
};

const mainCheckout = () =>
  spawnSync("git", ["worktree", "list", "--porcelain"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .stdout.split("\n")
    .find((line) => line.startsWith("worktree "))
    ?.slice("worktree ".length);

export const linkMainCheckoutDevVars = () => {
  const checkout = mainCheckout();
  const shared = checkout && join(checkout, "apps/web/.dev.vars");

  if (!shared || shared === devVarsPath || !existsSync(shared)) return false;

  rmSync(devVarsPath, { force: true });
  symlinkSync(shared, devVarsPath);

  return true;
};
