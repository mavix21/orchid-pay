import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { parseSync } from "oxc-parser";

const generatedFiles = new Set([
  "apps/web/src/routeTree.gen.ts",
  "apps/web/worker-configuration.d.ts",
]);

const generatedFolders = ["packages/orchid-links/src/generated/"];

const isGenerated = (filename) =>
  generatedFiles.has(filename) ||
  generatedFolders.some((folder) => filename.startsWith(folder));

const filenames = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
).split("\0");

for (const filename of new Set(filenames)) {
  if (!/\.[cm]?[jt]sx?$/.test(filename) || isGenerated(filename)) continue;

  const source = await readFile(filename, "utf8");
  const parsed = parseSync(filename, source);

  for (const comment of parsed.comments) {
    if (source.startsWith("#!", comment.start)) continue;

    const line = source.slice(0, comment.start).split("\n").length;

    console.error(`${filename}:${line}: Code comments are forbidden.`);
    process.exitCode = 1;
  }
}
