import * as Schema from "effect/Schema";

export class Offline extends Schema.TaggedError<Offline>()("Offline", {}) {}

export class ServerUnreachable extends Schema.TaggedError<ServerUnreachable>()(
  "ServerUnreachable",
  {},
) {}

export class LedgerUnreachable extends Schema.TaggedError<LedgerUnreachable>()(
  "LedgerUnreachable",
  {},
) {}

export class ServiceFailed extends Schema.TaggedError<ServiceFailed>()(
  "ServiceFailed",
  {},
) {}

export class InvalidResponse extends Schema.TaggedError<InvalidResponse>()(
  "InvalidResponse",
  {},
) {}

export class SessionRequired extends Schema.TaggedError<SessionRequired>()(
  "SessionRequired",
  {},
) {}

export class RateLimited extends Schema.TaggedError<RateLimited>()(
  "RateLimited",
  {},
) {}

export const ServerFailure = Schema.Union([
  LedgerUnreachable,
  ServiceFailed,
  SessionRequired,
  RateLimited,
]);

export type ServerFailure = typeof ServerFailure.Type;

export const WalletUnavailable = Schema.Union([
  Offline,
  ServerUnreachable,
  LedgerUnreachable,
  ServiceFailed,
  SessionRequired,
  RateLimited,
  InvalidResponse,
]);

export type WalletUnavailable = typeof WalletUnavailable.Type;
