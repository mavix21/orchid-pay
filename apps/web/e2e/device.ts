import { spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { type Page, expect } from "@playwright/test";
import {
  AccountAddress,
  CredentialId,
  LocalPhraseEnvelope,
  PinnedCredential,
  PublicDeviceWallet,
  SealedDeviceWallet,
  Username,
  localEnvelopeVersion,
} from "@workspace/wallet";
import {
  newWalletAddress,
  openUsdcAccount,
  recordEpochAt,
  recordNetwork,
} from "@workspace/wallet/local-chain";
import * as Schema from "effect/Schema";

export const addAuthenticator = async (page: Page, hasPrf: boolean) => {
  const session = await page.context().newCDPSession(page);

  await session.send("WebAuthn.enable");

  const { authenticatorId } = await session.send(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        hasPrf,
        automaticPresenceSimulation: true,
      },
    },
  );

  return {
    session,
    authenticatorId,
  };
};

const addSeededCredential = async (page: Page) => {
  const authenticator = await addAuthenticator(page, false);

  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });

  const id = randomBytes(16);

  await authenticator.session.send("WebAuthn.addCredential", {
    authenticatorId: authenticator.authenticatorId,
    credential: {
      credentialId: id.toString("base64"),
      isResidentCredential: true,
      rpId: "localhost",
      privateKey: privateKey
        .export({ type: "pkcs8", format: "der" })
        .toString("base64"),
      userHandle: randomBytes(16).toString("base64"),
      signCount: 0,
    },
  });

  return {
    authenticator,
    id: id.toString("base64url"),
    publicKey: publicKey
      .export({ type: "spki", format: "der" })
      .toString("base64url"),
  };
};

export const countPasskeyPrompts = async (page: Page) => {
  await page.addInitScript(() => {
    const record = (kind: "create" | "get") =>
      sessionStorage.setItem(
        `prompts-${kind}`,
        String(Number(sessionStorage.getItem(`prompts-${kind}`) ?? 0) + 1),
      );

    const credentials = navigator.credentials;
    const create = credentials.create.bind(credentials);
    const get = credentials.get.bind(credentials);

    credentials.create = (options) => {
      record("create");

      return create(options);
    };

    credentials.get = (options) => {
      record("get");

      return get(options);
    };
  });

  return () =>
    page.evaluate(() => ({
      create: Number(sessionStorage.getItem("prompts-create") ?? 0),
      get: Number(sessionStorage.getItem("prompts-get") ?? 0),
    }));
};

export const freshUsername = () =>
  `e2e_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;

export const usernameInput = (page: Page) => page.getByRole("textbox");

export const submitButton = (page: Page) => page.getByTestId("create-submit");

export const serverFunction = "/_serverFn/";

const e2eContainer = "orchid-e2e-database";

const runSql = (sql: string, failure: string) => {
  const result = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      e2eContainer,
      "psql",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "orchid",
      "-d",
      "orchid",
    ],
    { input: sql, encoding: "utf8" },
  );

  if (result.status !== 0)
    throw new Error(`${failure}: ${result.stderr || result.stdout}`);

  return result.stdout.trim();
};

export const markWalletRecovered = (address: AccountAddress) => {
  runSql(
    `
    UPDATE wallets SET
      status = 'recovered',
      "attemptEnvelope" = NULL, "attemptHash" = NULL, "attemptExpiresAt" = NULL
    WHERE address = '${address}';
  `,
    "Failed to mark wallet recovered",
  );
};

export const walletActive = (address: AccountAddress) =>
  runSql(
    `
    SELECT count(*) FROM wallets w
    JOIN usernames u ON u.address = w.address
    JOIN backups b ON b.address = w.address
    WHERE w.address = '${address}' AND w.status = 'active';
  `,
    "Failed to read the wallet",
  ) === "1";

export const storedWalletAddress = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const request = indexedDB.open("orchid-device", 1);

        request.addEventListener("error", () => reject(request.error));
        request.addEventListener("success", () => {
          const tx = request.result.transaction("entries", "readonly");
          const get = tx.objectStore("entries").get("wallet");

          get.addEventListener("error", () => reject(get.error));
          tx.addEventListener("complete", () => {
            request.result.close();
            resolve(get.result.public.address);
          });
        });
      }),
  );

interface SeededCredential {
  readonly id: string;
  readonly publicKey: string;
}

const seedActiveWalletRow = (
  address: AccountAddress,
  username: Username,
  seeded: SeededCredential,
) => {
  const sql = `
    INSERT INTO wallets (address, status, network, "testnetEpoch")
    VALUES ('${address}', 'active', '${recordNetwork}', '${recordEpochAt(Date.now())}');
    INSERT INTO usernames (username, address) VALUES ('${username}', '${address}');
    INSERT INTO backups (
      "credentialId", address, username, "publicKey", algorithm, counter, iv, ciphertext
    ) VALUES (
      '${seeded.id}', '${address}', '${username}', '${seeded.publicKey}', 'ES256', 0, 'AAAA', 'AAAA'
    );
  `;

  runSql(sql, "Failed to seed open wallet row");
};

const seededRecord = (
  address: AccountAddress,
  username: Username,
  seeded: SeededCredential,
) => {
  const credentialId = Schema.decodeSync(CredentialId)(seeded.id);

  return Schema.encodeSync(SealedDeviceWallet)(
    new SealedDeviceWallet({
      version: localEnvelopeVersion,
      public: new PublicDeviceWallet({
        address,
        username,
        backup: "stored",
      }),
      credential: new PinnedCredential({
        id: credentialId,
        publicKey: seeded.publicKey,
        algorithm: "ES256",
      }),
      envelope: new LocalPhraseEnvelope({
        version: localEnvelopeVersion,
        network: recordNetwork,
        address,
        credentialId,
        salt: new Uint8Array(32).fill(1),
        iv: new Uint8Array(12).fill(2),
        ciphertext: new Uint8Array(32).fill(3),
      }),
    }),
  );
};

export const storedWalletRecord = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<boolean>((resolve, reject) => {
        const request = indexedDB.open("orchid-device", 1);

        request.addEventListener("upgradeneeded", () => {
          if (!request.result.objectStoreNames.contains("entries"))
            request.result.createObjectStore("entries");
        });
        request.addEventListener("error", () => reject(request.error));
        request.addEventListener("success", () => {
          const tx = request.result.transaction("entries", "readonly");
          const get = tx.objectStore("entries").get("wallet");

          get.addEventListener("error", () => reject(get.error));
          tx.addEventListener("complete", () => {
            request.result.close();
            resolve(get.result !== undefined);
          });
        });
      }),
  );

export const seedWallet = async (page: Page, usernameText: string) => {
  const address = Schema.decodeSync(AccountAddress)(newWalletAddress());

  const username = Schema.decodeSync(Username)(usernameText);

  await openUsdcAccount(address);

  const credential = await addSeededCredential(page);

  seedActiveWalletRow(address, username, credential);

  const record = seededRecord(address, username, credential);

  await page.goto("/");
  await page.evaluate(
    (encoded) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("orchid-device", 1);

        request.addEventListener("upgradeneeded", () => {
          if (!request.result.objectStoreNames.contains("entries"))
            request.result.createObjectStore("entries");
        });
        request.addEventListener("error", () => reject(request.error));
        request.addEventListener("success", () => {
          const tx = request.result.transaction("entries", "readwrite");

          tx.objectStore("entries").put(encoded, "wallet");
          tx.addEventListener("error", () => reject(tx.error));
          tx.addEventListener("complete", () => {
            request.result.close();
            document.cookie = "orchid-wallet=1; path=/; samesite=lax";
            resolve();
          });
        });
      }),
    record,
  );

  return { address };
};

export const confirmSession = async (page: Page) => {
  await page.getByTestId("confirm-session").click();
  await expect(page.getByTestId("session-confirmation")).toBeHidden({
    timeout: 30_000,
  });
};

export const visit = async (page: Page, path: string) => {
  await page.goto(path);
  await confirmSession(page);
};

export const openWallet = async (page: Page, usernameText: string) => {
  const { address } = await seedWallet(page, usernameText);

  await visit(page, "/home");
  await expect(page).toHaveURL("/home", { timeout: 60_000 });

  return address;
};

export const enrollWallet = async (page: Page, usernameText: string) => {
  const authenticator = await addAuthenticator(page, true);

  await page.goto("/");
  await page.getByTestId("start-create").click();
  await usernameInput(page).fill(usernameText);
  await submitButton(page).click();
  await expect(page.getByTestId("enrollment-step")).toHaveAttribute(
    "data-stage",
    "activate",
    { timeout: 30_000 },
  );
  await page.getByTestId("enrollment-continue").click();
  await expect(page.getByTestId("open-send")).toBeVisible({ timeout: 120_000 });

  const address = await storedWalletAddress(page);

  await expect
    .poll(() => walletActive(Schema.decodeSync(AccountAddress)(address)), {
      timeout: 120_000,
    })
    .toBe(true);

  return { address, authenticator };
};

export const withoutPrf = async (
  page: Page,
  authenticator: Awaited<ReturnType<typeof addAuthenticator>>,
) => {
  const { credentials } = await authenticator.session.send(
    "WebAuthn.getCredentials",
    { authenticatorId: authenticator.authenticatorId },
  );

  await authenticator.session.send("WebAuthn.removeVirtualAuthenticator", {
    authenticatorId: authenticator.authenticatorId,
  });

  const replacement = await addAuthenticator(page, false);

  await Promise.all(
    credentials.map((credential) =>
      replacement.session.send("WebAuthn.addCredential", {
        authenticatorId: replacement.authenticatorId,
        credential,
      }),
    ),
  );

  return replacement;
};

export const storedLinkCiphertexts = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<Array<string>>((resolve, reject) => {
        const request = indexedDB.open("orchid-device", 1);

        request.addEventListener("error", () => reject(request.error));
        request.addEventListener("success", () => {
          const tx = request.result.transaction("entries", "readonly");
          const get = tx.objectStore("entries").get("payment-links");

          get.addEventListener("error", () => reject(get.error));
          tx.addEventListener("complete", () => {
            request.result.close();
            resolve(
              Array.isArray(get.result)
                ? get.result.map((entry) => String(entry.ciphertext))
                : [],
            );
          });
        });
      }),
  );

export const storedText = (page: Page) =>
  page.evaluate(async () => {
    const databases = await indexedDB.databases();

    const dumps = await Promise.all(
      databases.flatMap(({ name }) =>
        name === undefined
          ? []
          : [
              new Promise<string>((resolve, reject) => {
                const request = indexedDB.open(name);

                request.addEventListener("error", () => reject(request.error));
                request.addEventListener("success", () => {
                  const db = request.result;
                  const stores = Array.from(db.objectStoreNames);

                  if (stores.length === 0) {
                    db.close();
                    resolve("");

                    return;
                  }

                  const tx = db.transaction(stores, "readonly");

                  const reads = stores.map((store) =>
                    tx.objectStore(store).getAll(),
                  );

                  tx.addEventListener("error", () => reject(tx.error));
                  tx.addEventListener("complete", () => {
                    db.close();
                    resolve(JSON.stringify(reads.map((read) => read.result)));
                  });
                });
              }),
            ],
      ),
    );

    return [
      ...dumps,
      JSON.stringify({ ...localStorage }),
      JSON.stringify({ ...sessionStorage }),
      document.cookie,
    ].join("\n");
  });
