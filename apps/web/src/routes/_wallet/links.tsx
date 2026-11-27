import { ChevronLeftIcon } from "lucide-react";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@workspace/ui/components/item";
import { Skeleton } from "@workspace/ui/components/skeleton";
import type {
  ListedPaymentLink,
  PaymentLinksOutcome,
  ReceivedPaymentLink,
  ResolvePaymentLinkOutcome,
  SavedLinkTarget,
} from "@workspace/wallet";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";

import { formattingLocale } from "@/locale/format";
import {
  Screen,
  ScreenActions,
  ScreenNote,
  ScreenStatus,
} from "@/components/screen";
import { TopNav } from "@/components/top-nav";
import type { RecoverableLink } from "@/links/outcomes";
import { ResultButton } from "@/links/link-result";
import { LinkShareModal, useLinkReveal } from "@/links/link-reveal";
import { RecoveryAnswer, useRecovery } from "@/links/recovery";
import { OpenRequests } from "@/requests/open-requests";
import { amountLabel } from "@/send/money";
import { paymentRequestEffects } from "@/wallet/payment-requests";
import { unavailableMessage } from "@/wallet/unavailable";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_wallet/links")({
  ssr: false,
  pendingMs: 0,
  pendingComponent: () => <LinksFrame loading />,
  preload: false,
  loader: async ({ context }) => {
    const requested = Effect.runPromise(paymentRequestEffects.open());
    const latest = await context.walletClient.resolvePaymentLink();
    const links = await context.walletClient.paymentLinks();

    return { latest, links, requests: await requested };
  },
  component: PaymentLinks,
});

type NoticeAction = Data.TaggedEnum<{
  Recover: { readonly link: SavedLinkTarget; readonly savedOnDevice: boolean };
  Recheck: {};
  Browse: {};
}>;

const NoticeAction = Data.taggedEnum<NoticeAction>();

class LatestNotice {
  constructor(
    readonly title: string,
    readonly message: string,
    readonly action: NoticeAction,
  ) {}
}

const latestNotice = (
  latest: ResolvePaymentLinkOutcome,
): Option.Option<LatestNotice> =>
  Match.valueTags(latest, {
    LatestPaymentLink: (resolved) =>
      Option.some(
        resolved.savedOnDevice
          ? new LatestNotice(
              m.links_latest_open_title(),
              m.link_saved_note(),
              NoticeAction.Recover({ link: resolved, savedOnDevice: true }),
            )
          : new LatestNotice(
              m.links_latest_lost_title(),
              m.link_lost(),
              NoticeAction.Recover({ link: resolved, savedOnDevice: false }),
            ),
      ),
    Pending: () =>
      Option.some(
        new LatestNotice(
          m.link_last_creating_title(),
          m.links_latest_creating(),
          NoticeAction.Recheck(),
        ),
      ),
    ApprovalOutstanding: () =>
      Option.some(
        new LatestNotice(
          m.links_operation_title(),
          m.links_operation_note(),
          NoticeAction.Recheck(),
        ),
      ),
    PaymentLinkReceiptInvalid: () =>
      Option.some(
        new LatestNotice(
          m.links_latest_unconfirmed_title(),
          m.links_latest_unconfirmed(),
          NoticeAction.Browse(),
        ),
      ),
    PaymentLinkNotFound: () => Option.none(),
    InvalidAddress: () => Option.none(),
    NoWallet: () => Option.none(),
    UnsupportedDevice: () => Option.none(),
    Offline: () => Option.none(),
    ServerUnreachable: () => Option.none(),
    LedgerUnreachable: () => Option.none(),
    ServiceFailed: () => Option.none(),
    SessionRequired: () => Option.none(),
    RateLimited: () => Option.none(),
    InvalidResponse: () => Option.none(),
  });

const listProblem = (
  links: Exclude<PaymentLinksOutcome, { _tag: "ListedPaymentLinks" }>,
) =>
  Match.valueTags(links, {
    NotOpened: () => m.common_account_activating(),
    InvalidAddress: () => m.common_stored_key_invalid(),
    NoWallet: () => m.session_no_wallet(),
    UnsupportedDevice: () => m.device_cannot_read_key(),
    Offline: unavailableMessage,
    ServerUnreachable: unavailableMessage,
    LedgerUnreachable: unavailableMessage,
    ServiceFailed: unavailableMessage,
    SessionRequired: unavailableMessage,
    RateLimited: unavailableMessage,
    InvalidResponse: unavailableMessage,
  });

const createdOn = (link: ListedPaymentLink, withSeconds: boolean) =>
  DateTime.toDate(link.createdAt).toLocaleString(formattingLocale(), {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: withSeconds ? "2-digit" : undefined,
    hourCycle: "h23",
  });

const linkLabel = (link: ListedPaymentLink) =>
  `${amountLabel(link.amount, link.asset)} ${createdOn(link, false)}`;

const listedLinks = (links: ReadonlyArray<ListedPaymentLink>) =>
  links.map((link) => ({
    link,
    created: createdOn(
      link,
      links.some(
        (other) =>
          other.unclaimedFunds !== link.unclaimedFunds &&
          linkLabel(other) === linkLabel(link),
      ),
    ),
  }));

function LinksFrame({
  loading = false,
  children,
}: {
  loading?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Screen>
      <TopNav
        title={m.links_title()}
        label={m.common_back()}
        icon={<ChevronLeftIcon absoluteStrokeWidth />}
        link={<Link to="/home" />}
      />
      {loading ? (
        <div
          aria-label={m.links_loading()}
          className="flex flex-col gap-3 px-5 pt-2"
        >
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : (
        children
      )}
    </Screen>
  );
}

function PaymentLinks() {
  const { latest, links, requests } = Route.useLoaderData();
  const router = useRouter();
  const { started, begin, confirm, reset } = useRecovery();
  const sharing = useLinkReveal();

  if (Option.isSome(started))
    return (
      <LinksFrame>
        <RecoveryAnswer
          recovery={started.value}
          onBegin={begin}
          onConfirm={confirm}
          onCancel={reset}
          done={
            <ResultButton
              onClick={() =>
                void router.invalidate({ forcePending: true }).finally(reset)
              }
            >
              {m.common_done()}
            </ResultButton>
          }
        />
      </LinksFrame>
    );

  return (
    <LinksFrame>
      <OpenRequests outcome={requests} />
      {Predicate.isTagged(links, "ListedPaymentLinks") ? (
        <LinkList
          links={links.links}
          received={links.received}
          notice={latestNotice(latest)}
          onRecheck={() => void router.invalidate()}
          onChoose={begin}
          onShare={sharing.open}
        />
      ) : (
        <ListProblem message={listProblem(links)} />
      )}
      <LinkShareModal sharing={sharing} onRecover={(target) => begin(target)} />
    </LinksFrame>
  );
}

const receivedOn = (link: ReceivedPaymentLink) =>
  DateTime.toDate(link.receivedAt).toLocaleString(formattingLocale(), {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

function ReceivedLinks({
  received,
}: {
  received: ReadonlyArray<ReceivedPaymentLink>;
}) {
  return received.length === 0 ? null : (
    <section
      aria-labelledby="received-links-title"
      className="flex flex-col gap-3"
    >
      <h2 id="received-links-title" className="text-label-lg">
        {m.links_received_title()}
      </h2>
      <div role="list" className="flex flex-col gap-3">
        {received.map((link) => (
          <Item
            key={link.id}
            variant="outline"
            role="listitem"
            data-testid="received-link"
            data-address={link.address}
          >
            <ItemContent>
              <ItemTitle className="whitespace-nowrap">
                {amountLabel(link.amount, link.asset)}
              </ItemTitle>
              <ItemDescription>
                {m.links_received_on({ date: receivedOn(link) })}
              </ItemDescription>
            </ItemContent>
          </Item>
        ))}
      </div>
    </section>
  );
}

function LinkList({
  links,
  received,
  notice,
  onChoose,
  onShare,
  onRecheck,
}: {
  links: ReadonlyArray<ListedPaymentLink>;
  received: ReadonlyArray<ReceivedPaymentLink>;
  notice: Option.Option<LatestNotice>;
  onChoose: (link: RecoverableLink, created?: string) => void;
  onShare: (link: SavedLinkTarget) => void;
  onRecheck: () => void;
}) {
  const latest = Option.flatMap(notice, ({ action }) =>
    Predicate.isTagged(action, "Recover")
      ? Option.some(action.link)
      : Option.none(),
  );

  const listed = links.filter((link) =>
    Option.isNone(
      Option.filter(
        latest,
        (shown) => shown.unclaimedFunds === link.unclaimedFunds,
      ),
    ),
  );

  const rows = listedLinks(listed);

  return (
    <>
      <main
        data-testid="payment-links"
        className="flex flex-1 flex-col gap-6 px-5 pt-2"
      >
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-h1">{m.links_open_title()}</h1>
          <p className="text-body text-muted-foreground">
            {m.links_open_note()}
          </p>
        </div>
        {Option.isSome(notice) ? (
          <section
            aria-labelledby="latest-link-title"
            data-testid="latest-link"
            className="flex flex-col gap-3 rounded-lg bg-muted p-4"
          >
            <h2 id="latest-link-title" className="text-label-lg">
              {notice.value.title}
            </h2>
            <p className="text-body text-muted-foreground">
              {notice.value.message}
            </p>
            {Match.valueTags(notice.value.action, {
              Recover: ({ link, savedOnDevice }) => (
                <>
                  {savedOnDevice ? (
                    <Button
                      className="w-full"
                      onClick={() => onShare(link)}
                      data-testid="reshare-latest-link"
                    >
                      {m.link_share()}
                    </Button>
                  ) : null}
                  <Button
                    className="w-full"
                    variant={savedOnDevice ? "secondary" : "default"}
                    onClick={() => onChoose(link)}
                    data-testid="recover-latest-link"
                  >
                    {m.link_recover_amount({
                      amount: amountLabel(link.amount, link.asset),
                    })}
                  </Button>
                </>
              ),
              Recheck: () => (
                <Button
                  className="w-full"
                  variant="secondary"
                  onClick={onRecheck}
                >
                  {m.receive_check_again()}
                </Button>
              ),
              Browse: () => null,
            })}
          </section>
        ) : null}
        {listed.length === 0 ? (
          <p className="text-body text-muted-foreground">
            {Option.isSome(latest) ? m.links_none_other() : m.links_none()}
          </p>
        ) : (
          <div role="list" className="flex flex-col gap-3">
            {rows.map(({ link, created }) => (
              <Item key={link.unclaimedFunds} variant="outline" role="listitem">
                <ItemContent>
                  <ItemTitle className="whitespace-nowrap">
                    {amountLabel(link.amount, link.asset)}
                  </ItemTitle>
                  <ItemDescription>{created}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  {link.savedOnDevice ? (
                    <Button
                      size="sm"
                      onClick={() => onShare(link)}
                      aria-label={m.links_share_again_label({
                        amount: amountLabel(link.amount, link.asset),
                        created,
                      })}
                      data-testid="reshare-link"
                    >
                      {m.links_share_again()}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onChoose(link, created)}
                    aria-label={m.links_recover_label({
                      amount: amountLabel(link.amount, link.asset),
                      created,
                    })}
                    data-testid="recover-link"
                  >
                    {m.link_recover()}
                  </Button>
                </ItemActions>
              </Item>
            ))}
          </div>
        )}
        <ReceivedLinks received={received} />
      </main>
      <ScreenActions>
        <Button
          className="w-full"
          nativeButton={false}
          render={<Link to="/send" />}
        >
          {m.links_create()}
        </Button>
      </ScreenActions>
    </>
  );
}

function ListProblem({ message }: { message: string }) {
  const router = useRouter();

  return (
    <>
      <ScreenStatus title={m.links_load_failed()}>
        <ScreenNote>{message}</ScreenNote>
      </ScreenStatus>
      <ScreenActions>
        <Button className="w-full" onClick={() => void router.invalidate()}>
          {m.common_retry()}
        </Button>
      </ScreenActions>
    </>
  );
}
