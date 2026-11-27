import * as Match from "effect/Match";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { paraglideVitePlugin } from "@inlang/paraglide-js";

function walletBoundaryProbe(): Plugin {
  return {
    name: "wallet-boundary-probe",
    transform(code, id) {
      const probe = process.env.ORCHID_WALLET_BOUNDARY_PROBE;

      if (!probe || !id.endsWith("/src/routes/index.tsx")) return;

      const source = Match.value(probe).pipe(
        Match.when(
          "relative",
          () => "../../../../packages/wallet/src/device/boundary.fixture",
        ),
        Match.when("transport", () => "../wallet/port.functions"),
        Match.when(
          "private",
          () => "@workspace/wallet/src/server/index.server",
        ),
        Match.orElse(() => "@workspace/wallet/server"),
      );

      const symbol = probe === "transport" ? "port" : "WalletSettings";

      return `${code}\nimport { ${symbol} as boundaryValue } from "${source}"; console.log(boundaryValue);`;
    },
  };
}

const config = defineConfig(({ command, mode, isPreview }) => {
  if (command === "serve" && mode === "neon") {
    const { DATABASE_URL_UNPOOLED } = loadEnv(
      mode,
      new URL("../../", import.meta.url).pathname,
      "DATABASE_URL_UNPOOLED",
    );

    if (
      DATABASE_URL_UNPOOLED &&
      !process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE
    ) {
      process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE =
        DATABASE_URL_UNPOOLED;
    }
  }

  const phoneOrigin =
    command === "serve" && !isPreview && process.env.ORCHID_PHONE_ORIGIN
      ? new URL(process.env.ORCHID_PHONE_ORIGIN)
      : undefined;

  return {
    resolve: { tsconfigPaths: true },
    ...(phoneOrigin && {
      server: {
        allowedHosts: [phoneOrigin.hostname],
        hmr: { protocol: "wss", clientPort: Number(phoneOrigin.port) },
      },
    }),
    plugins: [
      walletBoundaryProbe(),
      paraglideVitePlugin({ project: "./project.inlang" }),
      cloudflare({
        viteEnvironment: { name: "ssr" },
        ...(phoneOrigin && {
          config: {
            vars: {
              PASSKEY_ORIGINS: `http://localhost:3000,${phoneOrigin.origin}`,
            },
          },
        }),
      }),
      tailwindcss(),
      tanstackStart({
        importProtection: { include: ["src/**", "**/packages/wallet/src/**"] },
        router: {
          quoteStyle: "double",
          semicolons: true,
          codeSplittingOptions: {
            defaultBehavior: [
              ["component"],
              ["pendingComponent"],
              ["errorComponent"],
              ["notFoundComponent"],
            ],
          },
        },
      }),
      viteReact(),
    ],
  };
});

export default config;
