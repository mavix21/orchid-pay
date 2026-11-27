import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type {
  PasskeyAssertion,
  PasskeyChallenge,
  PasskeyRegistration,
  Username,
} from "../contract";

export class PasskeyCancelled extends Schema.TaggedError<PasskeyCancelled>()(
  "PasskeyCancelled",
  {},
) {}

export class PasskeyFailed extends Schema.TaggedError<PasskeyFailed>()(
  "PasskeyFailed",
  {},
) {}

export interface AuthenticatedPasskey {
  readonly assertion: PasskeyAssertion;
  readonly prf: Uint8Array<ArrayBuffer>;
}

export interface RegistrationRequest {
  readonly challenge: PasskeyChallenge;
  readonly username: Username;
}

export interface RegistrationCeremony {
  register(
    request: RegistrationRequest,
  ): Effect.Effect<
    Option.Option<PasskeyRegistration>,
    PasskeyCancelled | PasskeyFailed
  >;
}

export interface Passkeys {
  authenticate(
    challenge: PasskeyChallenge,
    salt: Uint8Array<ArrayBuffer>,
  ): Effect.Effect<
    Option.Option<AuthenticatedPasskey>,
    PasskeyCancelled | PasskeyFailed
  >;
}
