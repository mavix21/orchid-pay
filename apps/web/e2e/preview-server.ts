import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  fundedTestnetKeypair,
  openChannels,
  openSandboxPartner,
} from "@workspace/wallet/testnet";

const humanCheckTestKeys = {
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
};

const previewSecretsFile = fileURLToPath(
  new URL("../dist/server/.dev.vars", import.meta.url),
);

const fundedTestnetSecrets = async () => {
  const reserveSponsor = await fundedTestnetKeypair();
  const feePayer = await fundedTestnetKeypair();

  await openChannels(reserveSponsor.secret(), feePayer.secret());
  await openSandboxPartner(reserveSponsor.secret(), feePayer.secret());

  return {
    RESERVE_SPONSOR_SECRET: reserveSponsor.secret(),
    FEE_PAYER_SECRET: feePayer.secret(),
  };
};

const runScript = (script: string[]) =>
  new Promise<number>((resolve, reject) => {
    spawn(process.execPath, ["run", ...script], {
      stdio: "inherit",
      env: process.env,
    })
      .on("error", reject)
      .on("exit", (code) => resolve(code ?? 1));
  });

const [secrets, buildExitCode] = await Promise.all([
  fundedTestnetSecrets(),
  runScript(["build"]),
]);

if (buildExitCode !== 0) process.exit(buildExitCode);

const previewSecrets = {
  ...secrets,
  ...humanCheckTestKeys,
  SESSION_SECRET: randomBytes(32).toString("base64url"),
};

await writeFile(
  previewSecretsFile,
  Object.entries(previewSecrets)
    .map(([name, value]) => `${name}=${value}\n`)
    .join(""),
);

process.exit(await runScript(["preview", "--port", "4173", "--strictPort"]));
