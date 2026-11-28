import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { rootNodeFromAnchor, type AnchorIdl } from "@codama/nodes-from-anchor";
import { renderVisitor } from "@codama/renderers-js";
import { createFromRoot } from "codama";

const packageFolder = fileURLToPath(new URL("..", import.meta.url));

const idlPath = fileURLToPath(
  new URL("../../../target/idl/orchid_links.json", import.meta.url),
);

const idl: AnchorIdl = JSON.parse(await readFile(idlPath, "utf8"));

await createFromRoot(rootNodeFromAnchor(idl)).accept(
  renderVisitor(packageFolder, {
    kitImportStrategy: "rootOnly",
    syncPackageJson: false,
    nameTransformers: { fileName: (name) => `${name}.gen` },
  }),
);
