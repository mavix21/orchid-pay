import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const e2eDatabasePort = 55434;

export const e2eDatabaseUrl = `postgres://orchid:orchid-local@127.0.0.1:${e2eDatabasePort}/orchid`;

const container = "orchid-e2e-database";

const migrations = fileURLToPath(
  import.meta.resolve("@workspace/wallet/migrate"),
);

const run = (command: string, args: ReadonlyArray<string>, env = {}) =>
  spawnSync(command, args, {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });

const required = (command: string, args: ReadonlyArray<string>, env = {}) => {
  const result = run(command, args, env);

  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
    );
};

const pause = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const acceptsConnections = async (attempts: number): Promise<boolean> => {
  if (attempts === 0) return false;

  const ready = run("docker", [
    "exec",
    container,
    "pg_isready",
    "-h",
    "127.0.0.1",
    "-U",
    "orchid",
    "-d",
    "orchid",
  ]);

  if (ready.status === 0) return true;

  await pause(500);

  return acceptsConnections(attempts - 1);
};

export default async function startE2eDatabase() {
  run("docker", ["rm", "-f", container]);
  required("docker", [
    "run",
    "-d",
    "--rm",
    "--name",
    container,
    "-e",
    "POSTGRES_USER=orchid",
    "-e",
    "POSTGRES_PASSWORD=orchid-local",
    "-e",
    "POSTGRES_DB=orchid",
    "-p",
    `127.0.0.1:${e2eDatabasePort}:5432`,
    "postgres:17.12",
  ]);

  if (!(await acceptsConnections(60)))
    throw new Error(`${container} did not accept connections`);

  required("bun", [migrations], { DATABASE_URL_UNPOOLED: e2eDatabaseUrl });

  return () => {
    run("docker", ["stop", container]);
  };
}
