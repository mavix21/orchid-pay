import {
  type KeyObject,
  createHash,
  createHmac,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  CredentialId,
  PasskeyAssertion,
  type PasskeyChallenge,
  PasskeyRegistration,
} from "../src/contract";
import type {
  AssertionCeremony,
  PlatformAssertion,
  PrfInputs,
} from "../src/device/assertion";
import {
  PasskeyCancelled,
  PasskeyFailed,
  type Passkeys,
  type RegistrationCeremony,
} from "../src/device/passkeys";

interface SoftwareCredential {
  readonly id: Buffer;
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
  readonly prfSecret: Buffer;
  signCount: number;
}

const userPresent = 0x01;
const userPresentAndVerified = 0x05;
const attestedCredentialData = 0x40;

const sha256 = (data: Buffer | string) =>
  createHash("sha256").update(data).digest();

const counterBytes = (count: number) => {
  const bytes = Buffer.alloc(4);

  bytes.writeUInt32BE(count);

  return bytes;
};

const coseKey = (publicKey: KeyObject) => {
  const jwk = publicKey.export({ format: "jwk" });

  return Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    Buffer.from(jwk.x ?? "", "base64url"),
    Buffer.from([0x22, 0x58, 0x20]),
    Buffer.from(jwk.y ?? "", "base64url"),
  ]);
};

const noneAttestation = (authData: Buffer) =>
  Buffer.concat([
    Buffer.from([0xa3, 0x63]),
    Buffer.from("fmt"),
    Buffer.from([0x64]),
    Buffer.from("none"),
    Buffer.from([0x67]),
    Buffer.from("attStmt"),
    Buffer.from([0xa0, 0x68]),
    Buffer.from("authData"),
    Buffer.from([0x58, authData.length]),
    authData,
  ]);

const makeCredential = (id: Buffer): SoftwareCredential => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });

  return {
    id,
    privateKey,
    publicKey,
    prfSecret: randomBytes(32),
    signCount: 0,
  };
};

export class SoftwareAuthenticator {
  private current: SoftwareCredential | undefined;
  prf = true;
  cancels = false;
  userVerified = true;
  readonly issued: Array<PasskeyAssertion> = [];
  readonly requested: Array<Option.Option<PrfInputs>> = [];
  readonly registered: Array<PasskeyRegistration> = [];

  constructor(public origin: string) {}

  private clientData(type: string, challenge: PasskeyChallenge) {
    return Buffer.from(
      JSON.stringify({ type, challenge, origin: this.origin }),
    );
  }

  private rpIdHash() {
    return sha256(new URL(this.origin).hostname);
  }

  private evaluate(credential: SoftwareCredential, salt: Uint8Array) {
    return Uint8Array.from(
      createHmac("sha256", credential.prfSecret).update(salt).digest(),
    );
  }

  private signAssertion(
    credential: SoftwareCredential,
    challenge: PasskeyChallenge,
    flags: number,
    counter: number,
  ) {
    const clientDataJSON = this.clientData("webauthn.get", challenge);

    const authenticatorData = Buffer.concat([
      this.rpIdHash(),
      Buffer.from([flags]),
      counterBytes(counter),
    ]);

    const signature = sign(
      "sha256",
      Buffer.concat([authenticatorData, sha256(clientDataJSON)]),
      { key: credential.privateKey, dsaEncoding: "der" },
    );

    return new PasskeyAssertion({
      id: Schema.decodeSync(CredentialId)(credential.id.toString("base64url")),
      clientDataJSON: clientDataJSON.toString("base64url"),
      authenticatorData: authenticatorData.toString("base64url"),
      signature: signature.toString("base64url"),
    });
  }

  forge(id: string) {
    this.current = makeCredential(Buffer.from(id, "base64url"));
  }

  private createRegistration(challenge: PasskeyChallenge) {
    const credential = makeCredential(randomBytes(16));

    this.current = credential;
    const idLength = Buffer.alloc(2);

    idLength.writeUInt16BE(credential.id.length);

    const authenticatorData = Buffer.concat([
      this.rpIdHash(),
      Buffer.from([userPresentAndVerified | attestedCredentialData]),
      counterBytes(credential.signCount),
      Buffer.alloc(16),
      idLength,
      credential.id,
      coseKey(credential.publicKey),
    ]);

    const registration = new PasskeyRegistration({
      id: Schema.decodeSync(CredentialId)(credential.id.toString("base64url")),
      clientDataJSON: this.clientData("webauthn.create", challenge).toString(
        "base64url",
      ),
      authenticatorData: authenticatorData.toString("base64url"),
      attestationObject:
        noneAttestation(authenticatorData).toString("base64url"),
      publicKey: credential.publicKey
        .export({ type: "spki", format: "der" })
        .toString("base64url"),
      publicKeyAlgorithm: -7,
      transports: ["internal"],
    });

    this.registered.push(registration);

    return { credential, registration };
  }

  readonly registration: RegistrationCeremony = {
    register: (request) =>
      Effect.suspend(
        (): Effect.Effect<
          Option.Option<PasskeyRegistration>,
          PasskeyCancelled | PasskeyFailed
        > => {
          if (this.cancels) return Effect.fail(new PasskeyCancelled());

          return Effect.succeed(
            Option.some(
              this.createRegistration(request.challenge).registration,
            ),
          );
        },
      ),
  };

  enrollWithPrf(challenge: PasskeyChallenge, salt: Uint8Array<ArrayBuffer>) {
    const { credential, registration } = this.createRegistration(challenge);

    return this.prf
      ? Option.some({ prf: this.evaluate(credential, salt), registration })
      : Option.none();
  }

  readonly passkeys: Passkeys = {
    authenticate: (challenge, salt) =>
      Effect.suspend(() => {
        if (this.cancels) return Effect.fail(new PasskeyCancelled());

        const credential = this.current;

        if (credential === undefined || !this.prf)
          return Effect.succeed(Option.none());

        credential.signCount += 1;

        const assertion = this.signAssertion(
          credential,
          challenge,
          userPresentAndVerified,
          credential.signCount,
        );

        return Effect.succeed(
          Option.some({
            prf: this.evaluate(credential, salt),
            assertion,
          }),
        );
      }),
  };

  readonly assertions: AssertionCeremony = {
    assert: (request) =>
      Effect.suspend(
        (): Effect.Effect<
          PlatformAssertion,
          PasskeyCancelled | PasskeyFailed
        > => {
          this.requested.push(request.prf);

          if (this.cancels) return Effect.fail(new PasskeyCancelled());

          const credential = this.current;

          if (credential === undefined) return Effect.fail(new PasskeyFailed());

          const assertion = this.signAssertion(
            credential,
            request.challenge,
            this.userVerified ? userPresentAndVerified : userPresent,
            0,
          );

          this.issued.push(assertion);

          const evaluated = (
            pick: (inputs: PrfInputs) => Uint8Array | undefined,
          ) =>
            this.prf
              ? request.prf.pipe(
                  Option.flatMapNullishOr(pick),
                  Option.map((salt) => this.evaluate(credential, salt)),
                )
              : Option.none();

          const platform: PlatformAssertion = {
            assertion,
            prf: {
              first: evaluated((inputs) => inputs.first),
              second: evaluated((inputs) =>
                Option.getOrUndefined(inputs.second),
              ),
            },
          };

          return Effect.succeed(platform);
        },
      ),
  };
}
