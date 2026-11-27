import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import {
  type AccountAddress,
  type Approvals,
  type OpeningDraft,
  OpeningPending,
  Username,
  WalletClaim,
  type WalletPort,
  type WalletUnavailable,
} from "../contract";
import {
  type CorruptDeviceWallet,
  type KeyStore,
  type KeyStoreUnavailable,
  PublicDeviceWallet,
  type SealedDevice,
} from "./key-store";
import {
  type ConfirmOpeningOutcome,
  DraftRejected,
  InvalidUsername,
  NoWallet,
  OpeningReview,
  type ReviewOpeningOutcome,
  UnsupportedDevice,
} from "./outcomes";
import {
  reserveSponsorOf,
  reviewFromJson,
  reviewJson,
  standingNow,
} from "./opening-drafts";
import { pollSchedule } from "./polling";
import { Reserved, approveReviewed } from "./reviewed-approval";

interface OpeningTurn {
  readonly done: Option.Option<ReviewOpeningOutcome>;
  readonly pause: boolean;
}

type OnDraft = (
  wallet: PublicDeviceWallet,
  draft: OpeningDraft,
) => Effect.Effect<Option.Option<ReviewOpeningOutcome>>;

interface SponsorReservation {
  readonly wallet: PublicDeviceWallet;
  readonly address: AccountAddress;
  readonly sponsor: AccountAddress;
  readonly previous: AccountAddress | undefined;
}

export interface OpeningReviews {
  readonly issued: Ref.Ref<Option.Option<string>>;
  readonly device: SealedDevice | undefined;
}

export function deviceOpening(
  port: WalletPort,
  store: KeyStore,
  reviews: OpeningReviews,
) {
  const presenting = (redrafted: boolean): OnDraft => {
    let refreshed = false;

    return (wallet, draft) =>
      Effect.gen(function* () {
        const review = new OpeningReview({
          username: wallet.username,
          address: wallet.address,
          draft,
          redrafted: redrafted || refreshed,
        });

        const standing = yield* standingNow(wallet, review);

        if (standing === "expiring" && !refreshed && !redrafted) {
          refreshed = true;

          return Option.none();
        }

        if (standing !== "current") return Option.some(new DraftRejected());

        yield* Ref.set(reviews.issued, Option.some(reviewJson(review)));

        return Option.some(review);
      });
  };

  const observe = Effect.fn("Device.observeOpening")(function* (
    initial: PublicDeviceWallet,
    first: Option.Option<Approvals>,
    onDraft: OnDraft,
  ): Effect.fn.Return<
    ReviewOpeningOutcome,
    WalletUnavailable | KeyStoreUnavailable
  > {
    let wallet = initial;
    let approvals = first;

    const step: Effect.Effect<
      OpeningTurn,
      WalletUnavailable | KeyStoreUnavailable
    > = Effect.gen(function* () {
      const submitted = Option.isSome(approvals);

      const response = yield* port.open(
        new WalletClaim({
          username: wallet.username,
          address: wallet.address,
        }),
        approvals,
      );

      approvals = Option.none();

      return yield* Match.valueTags(response, {
        OpeningDraft: (draft) =>
          onDraft(wallet, draft).pipe(
            Effect.map((done): OpeningTurn => ({ done, pause: false })),
          ),
        OpeningPending: () =>
          Effect.succeed({ done: Option.none(), pause: !submitted }),
        AddressBound: (bound) =>
          bound.profile.address === wallet.address &&
          bound.profile.username !== wallet.username
            ? store
                .updatePublic((current) =>
                  current.address === wallet.address &&
                  current.username !== bound.profile.username
                    ? Option.some(
                        new PublicDeviceWallet({
                          ...current,
                          username: bound.profile.username,
                        }),
                      )
                    : Option.none(),
                )
                .pipe(
                  Effect.map((adopted): OpeningTurn => {
                    if (
                      Option.isNone(adopted) ||
                      adopted.value.wallet.address !== wallet.address ||
                      adopted.value.wallet.username !== bound.profile.username
                    )
                      return {
                        done: Option.some(new UnsupportedDevice()),
                        pause: false,
                      };

                    wallet = adopted.value.wallet;

                    return { done: Option.none(), pause: false };
                  }),
                )
            : Effect.succeed({ done: Option.some(bound), pause: false }),
        Opened: (outcome) =>
          Effect.succeed({ done: Option.some(outcome), pause: false }),
        UsernameTaken: (outcome) =>
          Effect.succeed({ done: Option.some(outcome), pause: false }),
        HumanCheckRefused: (outcome) =>
          Effect.succeed({ done: Option.some(outcome), pause: false }),
        InvalidAddress: (outcome) =>
          Effect.succeed({ done: Option.some(outcome), pause: false }),
        NotSponsored: (outcome) =>
          Effect.succeed({ done: Option.some(outcome), pause: false }),
      });
    });

    const last = yield* Effect.repeat(step, {
      schedule: pollSchedule<OpeningTurn>(
        (turn) => Option.isNone(turn.done),
        (turn) => turn.pause,
      ),
    });

    return Option.getOrElse(last.done, () => new OpeningPending());
  });

  const review = Effect.fn("Device.reviewOpening")(function* (
    usernameText: string,
  ): Effect.fn.Return<
    ReviewOpeningOutcome,
    WalletUnavailable | KeyStoreUnavailable
  > {
    const username = Schema.decodeUnknownOption(Username)(usernameText);

    if (Option.isNone(username)) return new InvalidUsername();

    const existing = yield* store.readPublic();

    if (Option.isNone(existing)) return new NoWallet();

    if (existing.value.backup !== "stored") return new UnsupportedDevice();

    const prepared = yield* store.updatePublic((current) =>
      current.address === existing.value.address &&
      current.username !== username.value
        ? Option.some(
            new PublicDeviceWallet({ ...current, username: username.value }),
          )
        : Option.none(),
    );

    if (
      Option.isNone(prepared) ||
      prepared.value.wallet.address !== existing.value.address ||
      prepared.value.wallet.username !== username.value
    )
      return new UnsupportedDevice();

    return yield* observe(
      prepared.value.wallet,
      Option.none(),
      presenting(false),
    );
  });

  const redraft = (
    snapshot: string,
    wallet: PublicDeviceWallet,
    shown: OpeningReview,
  ) =>
    Ref.modify(reviews.issued, (current) =>
      Option.contains(current, snapshot)
        ? [true, Option.none()]
        : [false, current],
    ).pipe(
      Effect.flatMap(
        (consumed): ReturnType<typeof observe> | Effect.Effect<DraftRejected> =>
          consumed && !shown.redrafted
            ? observe(wallet, Option.none(), presenting(true))
            : Effect.succeed(new DraftRejected()),
      ),
    );

  const afterRelease = (shown: OpeningReview): OnDraft => {
    const replacement = presenting(true);

    return (wallet, draft) =>
      shown.redrafted
        ? Effect.succeed(Option.some(new DraftRejected()))
        : replacement(wallet, draft);
  };

  const confirm = Effect.fn("Device.confirmOpening")(function* (
    shown: OpeningReview,
  ): Effect.fn.Return<
    ConfirmOpeningOutcome,
    WalletUnavailable | KeyStoreUnavailable | CorruptDeviceWallet
  > {
    const { device, issued } = reviews;

    if (device === undefined) return new UnsupportedDevice();

    const snapshot = yield* Ref.get(issued);

    if (Option.isNone(snapshot) || snapshot.value !== reviewJson(shown))
      return new DraftRejected();

    const presented = reviewFromJson(snapshot.value);
    const sponsor = reserveSponsorOf(presented.draft);

    if (Option.isNone(sponsor)) return new DraftRejected();

    const issuedHere = Effect.map(Ref.get(issued), (current) =>
      Option.contains(current, snapshot.value),
    );

    const sealed = yield* device.store.readSealed();

    if (Option.isNone(sealed)) return new NoWallet();

    const record = sealed.value;
    const observed = record.public;
    let released = false;

    if ((yield* standingNow(observed, presented)) === "expiring")
      return yield* redraft(snapshot.value, observed, presented);

    const approved = yield* approveReviewed(device, {
      record,
      requests: [presented.draft.request],
      holds: (wallet) =>
        Effect.zipWith(
          standingNow(wallet, presented),
          issuedHere,
          (standing, current) => current && standing === "current",
        ),
      reserve: (wallet) =>
        device.store
          .updatePublic((current) =>
            current.address === wallet.address &&
            current.username === presented.username &&
            current.reserveSponsor !== sponsor.value
              ? Option.some(
                  new PublicDeviceWallet({
                    ...current,
                    reserveSponsor: sponsor.value,
                  }),
                )
              : Option.none(),
          )
          .pipe(
            Effect.map(
              (
                committed,
              ): Reserved<SponsorReservation> | NoWallet | DraftRejected => {
                if (Option.isNone(committed)) return new NoWallet();

                return committed.value.wallet.address === wallet.address &&
                  committed.value.wallet.username === presented.username &&
                  committed.value.wallet.reserveSponsor === sponsor.value
                  ? new Reserved({
                      reservation: {
                        wallet: committed.value.wallet,
                        address: wallet.address,
                        sponsor: sponsor.value,
                        previous: wallet.reserveSponsor,
                      },
                    })
                  : new DraftRejected();
              },
            ),
          ),
      unreserve: (reservation) =>
        device.store
          .updatePublic((current) =>
            current.address === reservation.address &&
            current.reserveSponsor === reservation.sponsor &&
            reservation.previous !== reservation.sponsor
              ? Option.some(
                  new PublicDeviceWallet({
                    ...current,
                    reserveSponsor: reservation.previous,
                  }),
                )
              : Option.none(),
          )
          .pipe(Effect.asVoid),
      release: (approvals, reservation) =>
        Effect.suspend(() => {
          released = true;

          return Ref.update(issued, (current) =>
            Option.contains(current, snapshot.value) ? Option.none() : current,
          ).pipe(
            Effect.andThen(
              observe(
                reservation.wallet,
                Option.some(approvals),
                afterRelease(presented),
              ),
            ),
          );
        }),
    });

    if (!released && Predicate.isTagged(approved, "DraftRejected")) {
      const latest = yield* device.store.readPublic();

      return Option.isSome(latest) &&
        (yield* standingNow(latest.value, presented)) === "expiring"
        ? yield* redraft(snapshot.value, latest.value, presented)
        : approved;
    }

    return approved;
  });

  return { review, confirm };
}
