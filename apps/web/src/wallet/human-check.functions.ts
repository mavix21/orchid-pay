import { createServerFn } from "@tanstack/react-start";
import { humanCheckSiteKey } from "../server/human-check.server";

export const humanCheckSiteKeyFn = createServerFn({ method: "GET" }).handler(
  () => humanCheckSiteKey(),
);
