import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporaryDirectory = mkdtempSync(
  join(tmpdir(), "orchid-wallet-boundary-"),
);

const deploymentMetadata = new URL(
  "../../apps/web/.wrangler/deploy/config.json",
  import.meta.url,
);

const previousMetadata = existsSync(deploymentMetadata)
  ? readFileSync(deploymentMetadata)
  : undefined;

try {
  for (const probe of ["server", "relative", "private", "transport"]) {
    const result = spawnSync(
      "bun",
      [
        "run",
        "--cwd",
        "apps/web",
        "build",
        "--outDir",
        join(temporaryDirectory, probe),
      ],
      {
        cwd: new URL("../../", import.meta.url),
        env: { ...process.env, ORCHID_WALLET_BOUNDARY_PROBE: probe },
        encoding: "utf8",
      },
    );

    const output = result.stdout + result.stderr;

    if (probe === "transport") {
      if (result.status !== 0) {
        process.stderr.write(output);
        throw new Error("Wallet transport failed its client build");
      }

      process.stdout.write("Wallet transport: client build passed\n");
      continue;
    }

    const expected =
      probe === "private"
        ? /Missing.*specifier|not exported|not defined by.*exports/i
        : /\[import-protection\] Import denied in client environment/;

    if (result.status === 0 || !expected.test(output)) {
      process.stderr.write(output);
      throw new Error(
        `Wallet boundary probe ${probe} did not fail for the expected reason`,
      );
    }

    process.stdout.write(
      `Wallet boundary ${probe}: rejected by real Vite build\n`,
    );
  }
} finally {
  if (previousMetadata) writeFileSync(deploymentMetadata, previousMetadata);
  else rmSync(deploymentMetadata, { force: true });

  rmSync(temporaryDirectory, { recursive: true, force: true });
}
