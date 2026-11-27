import { defineConfig } from "@inlang/paraglide-js";

export default defineConfig({
  outdir: "./src/paraglide",
  outputStructure: "message-modules",
  strategy: [
    "cookie",
    "custom-senderLanguage",
    "preferredLanguage",
    "baseLocale",
  ],
  cookieName: "locale",
  cookieSameSite: "lax",
  cookieSecure: "auto",
  emitTsDeclarations: true,
  emitReadme: false,
  emitPrettierIgnore: false,
  includeEslintDisableComment: false,
});
