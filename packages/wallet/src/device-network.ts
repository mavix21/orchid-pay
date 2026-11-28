import type * as Option from "effect/Option";
import type { DestinationAddress, SigningRequest } from "./contract";
import type { SigningScheme } from "./device/signing-scheme";
import { deviceNetwork } from "./binding/networks";
import type { DraftFacts } from "./draft-facts";

export type { DraftFacts, PaymentFacts, PaymentLinkFacts } from "./draft-facts";

export interface DeviceNetwork {
  readonly network: string;
  readonly signingScheme: SigningScheme;
  readonly readDraft: (request: SigningRequest) => Option.Option<DraftFacts>;
  readonly creditedAccountOf: (
    destination: DestinationAddress,
  ) => DestinationAddress;
}

export const { network, signingScheme, readDraft, creditedAccountOf } =
  deviceNetwork;
