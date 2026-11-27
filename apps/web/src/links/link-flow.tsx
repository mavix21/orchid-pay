import { LinkIcon, ShareIcon } from "lucide-react";
import { useEffect, useEffectEvent, useReducer, useRef } from "react";
import { Link, useBlocker } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import {
  Field,
  FieldContent,
  FieldLabel,
  FieldTitle,
} from "@workspace/ui/components/field";
import { Switch } from "@workspace/ui/components/switch";
import {
  type Amount,
  type Asset,
  type PaymentLinkCreated,
  PaymentLinkIntent,
  type PaymentReview,
  type PositiveAmount,
  type SavedLinkTarget,
  formatAmount,
  parseAmount,
  precisionOf,
} from "@workspace/wallet";
import * as DateTime from "effect/DateTime";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";

import { ReviewHero } from "@/components/review-hero";
import { ScreenActions, ScreenNote, ScreenStatus } from "@/components/screen";
import { AmountPad } from "@/send/amount-pad";
import { amountLabel } from "@/send/money";
import { ReviewRow } from "@/send/payment-review";
import { useWalletTask } from "@/send/use-wallet-task";
import { walletEffects } from "@/wallet";

import {
  LinkResultScreen,
  LinkWorking,
  ResultButton,
  ResultLink,
} from "./link-result";
import {
  type RecoverableLink,
  createLinkResult,
  preparedLinkResult,
  resolveLinkResult,
} from "./outcomes";
import { type Delivery, LinkStep, delivered, entering } from "./link-step";
import { pageHidden, usePageDeparture } from "./page-departure";
import { RecoveryAnswer, useRecovery } from "./recovery";
import {
  LinkEvent,
  holdsUnsharedLink,
  reduceLinkFlow,
} from "./link-flow-state";
import {
  DeliveryActions,
  DeliveryNote,
  LinkShareModal,
  useLinkReveal,
} from "./link-reveal";
import { type ShareResult, copyLink, shareLink } from "./share-link";

import { m } from "@/paraglide/messages";

const withSaving = (intent: PaymentLinkIntent, saveOnDevice: boolean) =>
  new PaymentLinkIntent({ ...intent, saveOnDevice });

function LinkAmountStep({
  amount,
  problem,
  asset,
  available,
  onAmount,
  onProblem,
  onIntent,
  onChangeDestination,
}: {
  amount: string;
  problem: Option.Option<string>;
  asset: Asset;
  available: Amount;
  onAmount: (amount: string) => void;
  onProblem: (problem: string) => void;
  onIntent: (intent: PaymentLinkIntent) => void;
  onChangeDestination: () => void;
}) {
  const field = useRef<HTMLInputElement>(null);

  const refuse = (found: string) => {
    onProblem(found);
    field.current?.focus();
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    Option.match(parseAmount(amount, precisionOf(asset)), {
      onNone: () => refuse(m.common_amount_invalid()),
      onSome: (entered) =>
        entered > available
          ? refuse(
              m.common_amount_available({
                amount: amountLabel(available, asset),
              }),
            )
          : onIntent(
              new PaymentLinkIntent({
                asset,
                amount: entered,
                saveOnDevice: true,
              }),
            ),
    });
  };

  return (
    <form className="flex flex-1 flex-col" noValidate onSubmit={submit}>
      <main className="flex flex-1 flex-col gap-4 px-5 pt-2">
        <button
          type="button"
          onClick={onChangeDestination}
          aria-label={m.common_change_destination()}
          data-testid="change-destination"
          className="flex items-center gap-3 rounded-lg bg-secondary px-4 py-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span className="text-body text-muted-foreground">
            {m.common_to()}
          </span>
          <span className="truncate text-label-lg">{m.link_destination()}</span>
        </button>
        <AmountPad
          amount={amount}
          problem={problem}
          asset={asset}
          available={available}
          field={field}
          onAmount={onAmount}
        />
      </main>
      <ScreenActions>
        <Button
          className="w-full"
          type="submit"
          data-testid="review-link"
          disabled={Option.isNone(parseAmount(amount, precisionOf(asset)))}
        >
          {m.common_review()}
        </Button>
      </ScreenActions>
    </form>
  );
}

const renewalLeadMillis = 30_000;
const renewalFloorMillis = 5_000;

function LinkReview({
  intent,
  review,
  problem,
  renewing,
  onSave,
  onRenew,
  onCreate,
}: {
  intent: PaymentLinkIntent;
  review: PaymentReview;
  problem: Option.Option<string>;
  renewing: boolean;
  onSave: (saveOnDevice: boolean) => void;
  onRenew: () => void;
  onCreate: () => void;
}) {
  const renew = useEffectEvent(onRenew);

  useEffect(() => {
    if (renewing) return;

    const untilExpiry =
      DateTime.toEpochMillis(review.expiresAt) -
      DateTime.toEpochMillis(DateTime.nowUnsafe());

    const timer = setTimeout(
      renew,
      Math.max(untilExpiry - renewalLeadMillis, renewalFloorMillis),
    );

    return () => clearTimeout(timer);
  }, [review, renewing]);

  return (
    <>
      <main
        className="flex flex-1 flex-col gap-6 px-5 pt-2"
        data-testid="link-review"
        data-saved={intent.saveOnDevice}
        data-amount={formatAmount(review.amount, precisionOf(review.asset))}
      >
        <ReviewHero
          title={m.link_review_title()}
          amount={amountLabel(review.amount, review.asset)}
          network={review.network}
        />
        <dl className="flex flex-col rounded-lg border border-border px-4">
          <ReviewRow label={m.common_fee()}>{m.common_free()}</ReviewRow>
        </dl>
        <p className="text-body text-muted-foreground">
          {m.link_review_note()}
        </p>
        <FieldLabel htmlFor="save-link">
          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>{m.link_save()}</FieldTitle>
            </FieldContent>
            <Switch
              id="save-link"
              checked={intent.saveOnDevice}
              readOnly={renewing}
              onCheckedChange={onSave}
              data-testid="save-link"
            />
          </Field>
        </FieldLabel>
        {Option.isSome(problem) ? (
          <p role="alert" className="text-body text-destructive">
            {problem.value}
          </p>
        ) : null}
      </main>
      <ScreenActions>
        <Button
          className="w-full"
          onClick={onCreate}
          disabled={renewing}
          data-testid="confirm-link"
        >
          {m.link_create()}
        </Button>
      </ScreenActions>
    </>
  );
}

function LinkReceipt({
  created,
  delivery,
}: {
  created: RecoverableLink;
  delivery: Delivery;
}) {
  return (
    <ScreenStatus
      title={m.link_ready()}
      data-testid="link-created"
      media={
        <span className="flex size-14 items-center justify-center rounded-full bg-accent text-icon-accent [&_svg]:size-7">
          <LinkIcon absoluteStrokeWidth />
        </span>
      }
    >
      <p className="font-display text-h1 text-muted-foreground">
        {amountLabel(created.amount, created.asset)}
      </p>
      <ScreenNote>{m.link_ready_note()}</ScreenNote>
      <DeliveryNote delivery={delivery} />
    </ScreenStatus>
  );
}

function LinkCreated({
  created,
  delivery,
  sharing,
  onShare,
  onCopy,
  onLeave,
}: {
  created: PaymentLinkCreated;
  delivery: Delivery;
  sharing: boolean;
  onShare: () => void;
  onCopy: () => void;
  onLeave: () => void;
}) {
  return (
    <>
      <LinkReceipt created={created} delivery={delivery} />
      <ScreenActions>
        <DeliveryActions
          delivering={sharing}
          onShare={onShare}
          onCopy={onCopy}
        />
        {created.savedOnDevice || delivered(delivery) ? (
          <Button
            className="w-full"
            variant="ghost"
            nativeButton={false}
            render={<Link to="/home" data-testid="finish-link" />}
          >
            {delivered(delivery) ? m.common_done() : m.link_share_later()}
          </Button>
        ) : (
          <Button
            className="w-full"
            variant="ghost"
            onClick={onLeave}
            disabled={sharing}
            data-testid="leave-link"
          >
            {m.link_leave_unshared()}
          </Button>
        )}
      </ScreenActions>
    </>
  );
}

function LinkSent({
  link,
  delivery,
}: {
  link: RecoverableLink;
  delivery: Delivery;
}) {
  return (
    <>
      <LinkReceipt created={link} delivery={delivery} />
      <ScreenActions>
        <Button
          className="w-full"
          nativeButton={false}
          render={<Link to="/home" data-testid="finish-link" />}
        >
          {m.common_done()}
        </Button>
      </ScreenActions>
    </>
  );
}

function LostLink({ link }: { link: RecoverableLink }) {
  const { started, begin, confirm, reset } = useRecovery();

  if (Option.isSome(started))
    return (
      <RecoveryAnswer
        recovery={started.value}
        onBegin={begin}
        onConfirm={confirm}
        onCancel={reset}
        done={
          <ResultLink link={<Link to="/home" />}>{m.common_done()}</ResultLink>
        }
      />
    );

  return (
    <>
      <ScreenStatus title={m.link_lost_title()} data-testid="link-lost">
        <ScreenNote>{m.link_lost()}</ScreenNote>
      </ScreenStatus>
      <ScreenActions>
        <Button
          className="w-full"
          onClick={() => begin(link)}
          data-testid="recover-link"
        >
          {m.link_recover_amount({
            amount: amountLabel(link.amount, link.asset),
          })}
        </Button>
        <Button
          className="w-full"
          variant="secondary"
          nativeButton={false}
          render={<Link to="/links" />}
        >
          {m.link_recover_later()}
        </Button>
      </ScreenActions>
    </>
  );
}

function SavedLink({ link }: { link: SavedLinkTarget }) {
  const { started, begin, confirm, reset } = useRecovery();
  const sharing = useLinkReveal();

  if (Option.isSome(started))
    return (
      <RecoveryAnswer
        recovery={started.value}
        onBegin={begin}
        onConfirm={confirm}
        onCancel={reset}
        done={
          <ResultLink link={<Link to="/home" />}>{m.common_done()}</ResultLink>
        }
      />
    );

  return (
    <>
      <ScreenStatus
        title={m.link_saved_title()}
        data-testid="link-saved"
        media={
          <span className="flex size-14 items-center justify-center rounded-full bg-accent text-icon-accent [&_svg]:size-7">
            <LinkIcon absoluteStrokeWidth />
          </span>
        }
      >
        <p className="font-display text-h1 text-muted-foreground">
          {amountLabel(link.amount, link.asset)}
        </p>
        <ScreenNote>{m.link_saved_note()}</ScreenNote>
      </ScreenStatus>
      <ScreenActions>
        <Button
          className="w-full"
          onClick={() => sharing.open(link)}
          data-testid="reshare-link"
        >
          <ShareIcon />
          {m.link_share()}
        </Button>
        <Button
          className="w-full"
          variant="secondary"
          onClick={() => begin(link)}
          data-testid="recover-link"
        >
          {m.link_recover_amount({
            amount: amountLabel(link.amount, link.asset),
          })}
        </Button>
      </ScreenActions>
      <LinkShareModal sharing={sharing} onRecover={(target) => begin(target)} />
    </>
  );
}

const startingStep = (
  asset: Asset,
  initialAmount: Option.Option<PositiveAmount>,
): LinkStep =>
  Option.match(initialAmount, {
    onNone: entering,
    onSome: (amount) =>
      LinkStep.Reviewing({
        intent: new PaymentLinkIntent({ asset, amount, saveOnDevice: true }),
      }),
  });

export function LinkFlow({
  asset,
  available,
  initialAmount,
  nav,
  onChangeDestination,
}: {
  asset: Asset;
  available: Amount;
  initialAmount: Option.Option<PositiveAmount>;
  nav: (locked: boolean, edit?: () => void) => React.ReactNode;
  onChangeDestination: () => void;
}) {
  const task = useWalletTask();

  const [state, send] = useReducer(reduceLinkFlow, undefined, () => ({
    amount: Option.match(initialAmount, {
      onNone: () => "",
      onSome: (initial) => formatAmount(initial, precisionOf(asset)),
    }),
    step: startingStep(asset, initialAmount),
  }));

  usePageDeparture(
    () => send(LinkEvent.Concealed({ unloading: false })),
    () => send(LinkEvent.Concealed({ unloading: true })),
  );

  const locked = holdsUnsharedLink(state.step);

  useBlocker({ shouldBlockFn: () => locked, enableBeforeUnload: locked });

  const review = (intent: PaymentLinkIntent) =>
    task.run(walletEffects.reviewPaymentLink(intent), (answer) =>
      send(LinkEvent.ReviewAnswered({ answer })),
    );

  const prepare = (intent: PaymentLinkIntent) => {
    send(LinkEvent.ReviewStarted({ intent }));
    review(intent);
  };

  const prepareOffered = useEffectEvent(() => {
    if (
      Predicate.isTagged(state.step, "Reviewing") &&
      Option.isSome(initialAmount)
    )
      review(state.step.intent);
  });

  useEffect(prepareOffered, []);

  const create = (review: PaymentReview) => {
    send(LinkEvent.CreateStarted());
    task.run(walletEffects.confirmPaymentLink(review), (answer) =>
      send(LinkEvent.CreateAnswered({ answer })),
    );
  };

  const edit = () => send(LinkEvent.Edited());

  const check = () => {
    send(LinkEvent.CheckStarted());
    task.run(walletEffects.resolvePaymentLink(), (answer) =>
      send(LinkEvent.CheckAnswered({ answer })),
    );
  };

  const deliver = (
    link: PaymentLinkCreated,
    handOff: (shared: PaymentLinkCreated) => Promise<ShareResult>,
  ) => {
    send(LinkEvent.ShareStarted());
    void handOff(link).then((result) =>
      send(LinkEvent.ShareEnded({ result, pageHidden: pageHidden() })),
    );
  };

  const reviewed = (
    intent: PaymentLinkIntent,
    review: PaymentReview,
    problem: Option.Option<string>,
    renewing: boolean,
  ) => (
    <LinkReview
      intent={intent}
      review={review}
      problem={problem}
      renewing={renewing}
      onSave={(saveOnDevice) => prepare(withSaving(intent, saveOnDevice))}
      onRenew={() => prepare(intent)}
      onCreate={() => create(review)}
    />
  );

  const created = (link: PaymentLinkCreated, delivery: Delivery) => (
    <LinkCreated
      created={link}
      delivery={delivery}
      sharing={Predicate.isTagged(state.step, "Sharing")}
      onShare={() => deliver(link, shareLink)}
      onCopy={() => deliver(link, copyLink)}
      onLeave={() => send(LinkEvent.Left())}
    />
  );

  return (
    <>
      {nav(
        locked,
        Predicate.isTagged(state.step, "Reviewed") ||
          Predicate.isTagged(state.step, "Renewing")
          ? edit
          : undefined,
      )}
      {Match.valueTags(state.step, {
        Entering: ({ problem }) => (
          <LinkAmountStep
            amount={state.amount}
            problem={problem}
            asset={asset}
            available={available}
            onAmount={(amount) => send(LinkEvent.Typed({ amount }))}
            onProblem={(problem) => send(LinkEvent.Invalid({ problem }))}
            onIntent={prepare}
            onChangeDestination={onChangeDestination}
          />
        ),
        Reviewing: () => <LinkWorking label={m.link_preparing()} />,
        Reviewed: ({ intent, review, problem }) =>
          reviewed(intent, review, problem, false),
        Renewing: ({ intent, review }) =>
          reviewed(intent, review, Option.none(), true),
        Creating: () => (
          <LinkWorking label={m.link_creating()} note={m.link_keep_open()} />
        ),
        Refused: ({ intent, confirmed, outcome }) => {
          const screen = (confirmed ? createLinkResult : preparedLinkResult)(
            outcome,
            asset,
          );

          return (
            <LinkResultScreen outcome={outcome._tag} screen={screen}>
              {Match.value(screen.action).pipe(
                Match.when("once", () => (
                  <ResultButton
                    onClick={() => prepare(withSaving(intent, false))}
                  >
                    {m.link_create_without_saving()}
                  </ResultButton>
                )),
                Match.when("again", () => (
                  <ResultButton onClick={() => prepare(intent)}>
                    {m.common_retry()}
                  </ResultButton>
                )),
                Match.when("edit", () => (
                  <ResultButton onClick={edit}>
                    {m.link_change_amount()}
                  </ResultButton>
                )),
                Match.when("check", () => (
                  <ResultButton onClick={check}>
                    {m.receive_check_again()}
                  </ResultButton>
                )),
                Match.when("home", () => (
                  <ResultLink link={<Link to="/home" />}>
                    {m.common_back_home()}
                  </ResultLink>
                )),
                Match.when("links", () => (
                  <ResultLink link={<Link to="/links" />}>
                    {m.link_view_mine()}
                  </ResultLink>
                )),
                Match.when("assets", () => (
                  <ResultLink link={<Link to="/send" />}>
                    {m.link_choose_asset()}
                  </ResultLink>
                )),
                Match.when("elsewhere", () => (
                  <>
                    <ResultButton onClick={onChangeDestination}>
                      {m.link_send_another_way()}
                    </ResultButton>
                    <ResultLink variant="secondary" link={<Link to="/send" />}>
                      {m.link_choose_asset()}
                    </ResultLink>
                  </>
                )),
                Match.exhaustive,
              )}
            </LinkResultScreen>
          );
        },
        Created: ({ link, delivery }) => created(link, delivery),
        Sharing: ({ link, delivery }) => created(link, delivery),
        Sent: ({ link, delivery }) => (
          <LinkSent link={link} delivery={delivery} />
        ),
        Saved: ({ link }) => <SavedLink link={link} />,
        Lost: ({ link }) => <LostLink link={link} />,
        Checking: () => <LinkWorking label={m.link_checking()} />,
        Checked: ({ outcome }) => {
          const screen = resolveLinkResult(outcome);

          return (
            <LinkResultScreen outcome={outcome._tag} screen={screen}>
              {Match.value(screen.action).pipe(
                Match.when("check", () => (
                  <ResultButton onClick={check}>
                    {m.receive_check_again()}
                  </ResultButton>
                )),
                Match.when("home", () => (
                  <ResultLink link={<Link to="/home" />}>
                    {m.common_back_home()}
                  </ResultLink>
                )),
                Match.when("links", () => (
                  <ResultLink link={<Link to="/links" />}>
                    {m.link_view_mine()}
                  </ResultLink>
                )),
                Match.exhaustive,
              )}
            </LinkResultScreen>
          );
        },
      })}
    </>
  );
}
