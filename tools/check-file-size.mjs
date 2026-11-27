import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";

const maxTokens = 5000;
const bytesPerToken = 4;

const ignored = [
  /(^|\/)bun\.lock$/,
  /(^|\/)Cargo\.lock$/,
  /(^|\/)[^/]*-lock\.json$/,
  /\.gen\.ts$/,
  /(^|\/)worker-configuration\.d\.ts$/,
  /^packages\/wallet\/drizzle\//,
  /^packages\/ui\/src\/components\//,
  /^tools\/oxlint\/anti-slop\//,
  /^\.(agent|agents|claude|codex|continue|cursor|gemini|opencode|pi|roo|windsurf)\//,
  /\.(png|jpe?g|gif|webp|avif|ico|pdf|woff2?|ttf|otf|mp4|webm|wasm)$/i,
];

const git = (args) => spawnSync("git", args, { encoding: "utf8" }).stdout;

const paths = process.argv.slice(2);
const staged = paths.length === 0;

const candidates = staged
  ? git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]).split(
      "\0",
    )
  : paths;

const oversized = [];

for (const path of candidates) {
  if (path === "" || ignored.some((pattern) => pattern.test(path))) {
    continue;
  }

  const bytes = staged
    ? Number(git(["cat-file", "-s", `:${path}`]))
    : statSync(path).size;

  if (bytes > maxTokens * bytesPerToken) {
    oversized.push(`  ${path}: ${Math.ceil(bytes / bytesPerToken)} tokens`);
  }
}

if (oversized.length > 0) {
  process.stderr
    .write(`File size check failed: ${oversized.length} file(s) exceed ${maxTokens} tokens (tokens = bytes / ${bytesPerToken}).

${oversized.join("\n")}

Split each file before committing:
  1. Find the cohesive units inside it: types, constants, pure helpers, subcomponents, one feature's handlers, one group of tests.
  2. Move each unit into its own module next to the original, named after what it does (for example wallet.ts -> wallet-types.ts, wallet-fees.ts).
  3. Import the moved code from the new modules where it is used. Keep the original file as the entry point only if other files import from it.
  4. Split a test file along the same lines as the source file it covers.
  5. Stage the new files and commit again. Every resulting file must be under ${maxTokens} tokens.

Do not bypass this with --no-verify, by adding the file to the ignore list in tools/check-file-size.mjs, or by deleting comments or squeezing formatting to fit.
`);
  process.exit(1);
}
