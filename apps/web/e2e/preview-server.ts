import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  localChainUrl,
  localSponsorSecret,
  startLocalChain,
  stopLocalChain,
} from "@workspace/wallet/local-chain";

const humanCheckTestKeys = {
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
};

const previewSecretsFile = fileURLToPath(
  new URL("../dist/server/.dev.vars", import.meta.url),
);

const runScript = (script: string[]) =>
  new Promise<number>((resolve, reject) => {
    spawn(process.execPath, ["run", ...script], {
      stdio: "inherit",
      env: process.env,
    })
      .on("error", reject)
      .on("exit", (code) => resolve(code ?? 1));
  });

const [chain, buildExitCode] = await Promise.all([
  startLocalChain(),
  runScript(["build"]),
]);

if (buildExitCode !== 0) {
  await stopLocalChain(chain);
  process.exit(buildExitCode);
}

const previewSecrets = {
  SOLANA_RPC_URL: localChainUrl,
  SPONSOR_SECRET: localSponsorSecret,
  ...humanCheckTestKeys,
  SESSION_SECRET: randomBytes(32).toString("base64url"),
};

await writeFile(
  previewSecretsFile,
  Object.entries(previewSecrets)
    .map(([name, value]) => `${name}=${value}\n`)
    .join(""),
);

const previewExitCode = await runScript([
  "preview",
  "--port",
  "4173",
  "--strictPort",
]);

await stopLocalChain(chain);

process.exit(previewExitCode);
