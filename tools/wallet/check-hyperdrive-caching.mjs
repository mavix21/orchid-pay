import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";

const configPath = resolve(
  process.argv[2] ??
    new URL("../../apps/web/wrangler.jsonc", import.meta.url).pathname,
);

const { default: config } = await import(configPath);

const targets = [
  ...(config.hyperdrive ?? []).map((entry) => ({ ...entry, env: undefined })),
  ...Object.entries(config.env ?? {}).flatMap(([env, settings]) =>
    (settings.hyperdrive ?? []).map((entry) => ({ ...entry, env })),
  ),
];

const fail = (message) => {
  process.stderr.write(`Hyperdrive caching check failed: ${message}\n`);
  process.exit(1);
};

const unreadableOutput = (label, id) =>
  fail(
    `could not read caching.disabled for ${label} (${id}) from \`wrangler hyperdrive get\`. Its output is not documented by Cloudflare and its shape may have changed. Verify manually that query caching is disabled for this configuration, then update this check before deploying.`,
  );

if (targets.length === 0) fail(`no Hyperdrive binding in ${configPath}.`);

for (const { binding, id, env } of targets) {
  const label = env ? `env.${env} binding ${binding}` : `binding ${binding}`;

  if (/^0+$/.test(id))
    fail(
      `${label} still has the placeholder id. Create the Hyperdrive configuration with --caching-disabled and set its id first.`,
    );

  const args = [
    "hyperdrive",
    "get",
    id,
    "--config",
    configPath,
    ...(env ? ["--env", env] : []),
  ];

  const result = spawnSync("wrangler", args, {
    cwd: dirname(configPath),
    encoding: "utf8",
  });

  if (result.status !== 0)
    fail(
      `wrangler hyperdrive get ${id} exited with ${result.status}.\n${result.stderr}`,
    );

  const start = result.stdout.indexOf("{");

  if (start === -1) unreadableOutput(label, id);

  let disabled;

  try {
    disabled = JSON.parse(result.stdout.slice(start)).caching?.disabled;
  } catch {
    unreadableOutput(label, id);
  }

  if (disabled === false)
    fail(
      `${label} (${id}) has query caching enabled. Run: wrangler hyperdrive update ${id} --caching-disabled`,
    );

  if (disabled !== true) unreadableOutput(label, id);

  process.stdout.write(
    `Hyperdrive ${label} (${id}): query caching disabled.\n`,
  );
}
