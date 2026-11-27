import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type {
  Approval,
  TransferDraft,
  TransferOrder,
  WalletUnavailable,
} from "../contract";
import type { KeyStoreUnavailable, PublicDeviceWallet } from "./key-store";
import type { SendOutcome } from "./outcomes";

export interface DraftNext {
  readonly wallet: PublicDeviceWallet;
  readonly approval: Option.Option<Approval>;
  readonly refreshed: boolean;
}

export interface DraftResult<D> {
  readonly done: Option.Option<D | SendOutcome>;
  readonly next?: DraftNext;
}

export type DraftHandler<D> = (
  wallet: PublicDeviceWallet,
  order: TransferOrder,
  draft: TransferDraft,
  finalStep: boolean,
  refreshed: boolean,
) => Effect.Effect<DraftResult<D>, WalletUnavailable | KeyStoreUnavailable>;

export type ObserveDraft<D> = (
  wallet: PublicDeviceWallet,
  order: TransferOrder,
  draft: TransferDraft,
) => Effect.Effect<D | SendOutcome, WalletUnavailable | KeyStoreUnavailable>;

export const observeDraft =
  <D>(handler: ObserveDraft<D>): DraftHandler<D> =>
  (wallet, order, draft) =>
    handler(wallet, order, draft).pipe(
      Effect.map((done): DraftResult<D> => ({ done: Option.some(done) })),
    );
