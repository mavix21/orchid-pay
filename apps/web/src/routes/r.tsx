import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { BanknoteIcon, WalletIcon } from "lucide-react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import {
  type AssetStep,
  DraftRejected,
  type LinkReceiveReview,
  type PaymentLinkOpen,
  type ReadLinkCode,
  type WalletEnrolled,
  readLinkCode,
} from "@workspace/wallet";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";

import { PasskeyBrowserGate } from "@/browser/passkey-browser-gate";
import { BrandLogo } from "@/components/brand-logo";
import { NetworkBadge } from "@/components/network-badge";
import { BloomActions, BloomHero } from "@/components/orchid-bloom";
import { Screen } from "@/components/screen";
import { ExternalClaimFlow } from "@/links/external-claim-flow";
import { PayoutFlow } from "@/links/payout-flow";
import { linkPreviewMeta } from "@/links/link-preview";
import { LanguageSwitch } from "@/locale/language-switch";
import { senderLanguageQuery } from "@/locale/sender-language";
import {
  LinkResultScreen,
  ResultButton,
  ResultLink,
} from "@/links/link-result";
import type { LinkScreen } from "@/links/outcomes";
import {
  type ReceiveAction,
  type ReceiveConclusion,
  receiveScreen,
} from "@/links/receive-outcomes";
import { m } from "@/paraglide/messages";
import { getLocale } from "@/paraglide/runtime";
import { amountLabel } from "@/send/money";
import { DeviceFailure, useWalletTask } from "@/send/use-wallet-task";
import { walletEffects } from "@/wallet";
import { enrollmentEffects } from "@/wallet/enrollment";
import { EnrollmentFlow } from "@/wallet/enrollment-flow";
import { SessionConfirmation } from "@/wallet/session-confirmation";

export const Route = createFileRoute("/r")({
  ssr: false,
  head: () => ({
    meta: linkPreviewMeta({
      title: m.receive_preview_title(),
      description: m.receive_preview_description(),
      path: `/r?${senderLanguageQuery(getLocale())}`,
      image: "/og-payment-link.png",
    }),
  }),
  component: PaymentLinkPage,
});

type ReceiveStep = Data.TaggedEnum<{
  Reading: {};
  Offered: { readonly open: PaymentLinkOpen };
  ExternalClaiming: { readonly open: PaymentLinkOpen };
  PayingOut: { readonly open: PaymentLinkOpen };
  Enrolling: { readonly open: PaymentLinkOpen };
  Preparing: { readonly open: PaymentLinkOpen };
  SessionNeeded: { readonly open: PaymentLinkOpen };
  Reviewing: {
    readonly open: PaymentLinkOpen;
    readonly review: LinkReceiveReview;
    readonly problem: Option.Option<string>;
  };
  Confirming: { readonly review: LinkReceiveReview };
  Concluded: {
    readonly outcome: string;
    readonly screen: LinkScreen<ReceiveAction>;
    readonly received: string;
  };
}>;

const ReceiveStep = Data.taggedEnum<ReceiveStep>();

const subscribeToLocation = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);

  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
  };
};

const readFragment = () => window.location.hash.slice(1);

const noFragmentOnServer = () => "";

const concluded = (outcome: ReceiveConclusion, received: string) =>
  ReceiveStep.Concluded({
    outcome: outcome._tag,
    screen: receiveScreen(outcome, received),
    received,
  });

const retriesReview = (answer: ReceiveConclusion) =>
  Predicate.isTagged(answer, "PasskeyCancelled") ||
  Predicate.isTagged(answer, "PasskeyFailed") ||
  Predicate.isTagged(answer, "WrongCredential") ||
  Predicate.isTagged(answer, "AssertionRejected");

function PaymentLinkPage() {
  const fragment = useSyncExternalStore(
    subscribeToLocation,
    readFragment,
    noFragmentOnServer,
  );

  const opened = useMemo(() => readLinkCode(fragment), [fragment]);

  return Option.match(opened, {
    onNone: () => (
      <Screen>
        <LinkResultScreen
          outcome={fragment === "" ? "LinkCodeMissing" : "LinkCodeInvalid"}
          screen={{
            title:
              fragment === ""
                ? m.receive_link_missing_title()
                : m.receive_link_incomplete_title(),
            message: m.receive_link_copy_whole(),
          }}
        >
          <ResultLink link={<Link to="/" />}>{m.receive_go_start()}</ResultLink>
        </LinkResultScreen>
      </Screen>
    ),
    onSome: (valid) => <ReceiveLink key={valid.code} opened={valid} />,
  });
}

function ReceiveLink({ opened }: { opened: ReadLinkCode }) {
  const { walletClient } = Route.useRouteContext();
  const task = useWalletTask();
  const [step, setStep] = useState<ReceiveStep>(ReceiveStep.Reading());
  const { code } = opened;

  const read = () => {
    setStep(ReceiveStep.Reading());
    task.run(walletEffects.paymentLink(code), (answer) =>
      setStep(
        Predicate.isTagged(answer, "PaymentLinkOpen")
          ? ReceiveStep.Offered({ open: answer })
          : concluded(answer, ""),
      ),
    );
  };

  useEffect(read, []);

  const review = (open: PaymentLinkOpen) => {
    const received = amountLabel(open.amount, open.asset);

    setStep(ReceiveStep.Preparing({ open }));
    task.run(walletEffects.reviewLinkReceive(code), (answer) =>
      setStep(
        Predicate.isTagged(answer, "LinkReceiveReview")
          ? ReceiveStep.Reviewing({
              open,
              review: answer,
              problem: Option.none(),
            })
          : Predicate.isTagged(answer, "SessionRequired")
            ? ReceiveStep.SessionNeeded({ open })
            : concluded(answer, received),
      ),
    );
  };

  const receive = (open: PaymentLinkOpen) => {
    task.run(
      Effect.all([walletEffects.saved(), enrollmentEffects.pending()]),
      (answer) => {
        if (answer instanceof DeviceFailure) {
          setStep(concluded(answer, ""));

          return;
        }

        const [saved, enrolling] = answer;

        if (Option.isSome(enrolling)) {
          setStep(ReceiveStep.Enrolling({ open }));

          return;
        }

        if (Predicate.isTagged(saved, "SavedWallet") && saved.openingApproved) {
          review(open);

          return;
        }

        setStep(
          Predicate.isTagged(saved, "SavedWallet") ||
            Predicate.isTagged(saved, "NoWallet")
            ? ReceiveStep.Enrolling({ open })
            : concluded(saved, ""),
        );
      },
    );
  };

  const confirm = (open: PaymentLinkOpen, shown: LinkReceiveReview) => {
    const received = amountLabel(shown.amount, shown.asset);

    setStep(ReceiveStep.Confirming({ review: shown }));
    task.run(walletEffects.confirmLinkReceive(shown, code), (answer) =>
      setStep(
        Predicate.isTagged(answer, "LinkReceiveReview")
          ? ReceiveStep.Reviewing({
              open,
              review: answer,
              problem: Option.none(),
            })
          : Predicate.isTagged(answer, "SessionRequired")
            ? ReceiveStep.SessionNeeded({ open })
            : retriesReview(answer)
              ? ReceiveStep.Reviewing({
                  open,
                  review: shown,
                  problem: Option.some(receiveScreen(answer, received).message),
                })
              : concluded(answer, received),
      ),
    );
  };

  const enrolled = (open: PaymentLinkOpen) => (outcome: WalletEnrolled) => {
    const received: AssetStep | undefined = outcome.received;

    if (received === undefined) {
      review(open);

      return;
    }

    if (outcome.receivedLink !== opened.link) {
      read();

      return;
    }

    setStep(
      concluded(
        Predicate.isTagged(received, "AssetDraft")
          ? new DraftRejected()
          : received,
        amountLabel(open.amount, open.asset),
      ),
    );
  };

  return Match.valueTags(step, {
    Reading: () => (
      <Screen>
        <p role="status" className="sr-only">
          {m.enrollment_checking_link()}
        </p>
      </Screen>
    ),
    Offered: ({ open }) => (
      <Screen>
        <ClaimHeader action={<LanguageSwitch />} />
        <main data-testid="link-offer" className="flex flex-1 flex-col px-5">
          <BloomHero
            motion="bloom"
            label={m.receive_sender_sent({ username: open.sender.username })}
            amount={amountLabel(open.amount, open.asset)}
          />
        </main>
        <BloomActions>
          <Button
            className="w-full"
            data-testid="receive-link"
            onClick={() => receive(open)}
          >
            {m.receive_in_orchid()}
          </Button>
          <div className="flex w-full flex-wrap items-center justify-center gap-x-1">
            <span className="text-caption text-muted-foreground">
              {m.receive_other_ways()}
            </span>
            <Button
              variant="ghost"
              size="sm"
              data-testid="receive-local-wallet"
              onClick={() => setStep(ReceiveStep.PayingOut({ open }))}
            >
              <BanknoteIcon className="text-icon-muted" />
              {m.receive_local_wallet()}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              data-testid="claim-external"
              onClick={() => setStep(ReceiveStep.ExternalClaiming({ open }))}
            >
              <WalletIcon className="text-icon-muted" />
              {m.receive_elsewhere()}
            </Button>
          </div>
        </BloomActions>
      </Screen>
    ),
    ExternalClaiming: ({ open }) => (
      <ExternalClaimFlow
        code={code}
        open={open}
        onBack={() => setStep(ReceiveStep.Offered({ open }))}
        onRecheck={read}
      />
    ),
    PayingOut: ({ open }) => (
      <PayoutFlow
        code={code}
        open={open}
        onBack={() => setStep(ReceiveStep.Offered({ open }))}
        onRecheck={read}
      />
    ),
    Enrolling: ({ open }) => (
      <PasskeyBrowserGate>
        <EnrollmentFlow
          title={m.receive_title()}
          incoming={m.receive_incoming({
            amount: amountLabel(open.amount, open.asset),
            username: open.sender.username,
          })}
          back={() => ({
            onClick: () => setStep(ReceiveStep.Offered({ open })),
          })}
          walletClient={walletClient}
          receive={opened}
          onEnrolled={enrolled(open)}
          onOpened={() => review(open)}
        />
      </PasskeyBrowserGate>
    ),
    Preparing: ({ open }) => (
      <ReceiveReview
        sender={open.sender.username}
        amount={amountLabel(open.amount, open.asset)}
        problem={Option.none()}
      />
    ),
    SessionNeeded: ({ open }) => (
      <>
        <ReceiveReview
          sender={open.sender.username}
          amount={amountLabel(open.amount, open.asset)}
          problem={Option.none()}
        />
        <SessionConfirmation
          client={walletClient}
          onConfirmed={() => review(open)}
        />
      </>
    ),
    Reviewing: ({ open, review: shown, problem }) => (
      <ReceiveReview
        sender={shown.sender.username}
        amount={amountLabel(shown.amount, shown.asset)}
        network={shown.network}
        problem={problem}
        onConfirm={() => confirm(open, shown)}
      />
    ),
    Confirming: ({ review: shown }) => (
      <Screen>
        <ClaimHeader />
        <main role="status" className="flex flex-1 flex-col px-5">
          <BloomHero
            motion="breathe"
            label={m.receive_receiving()}
            amount={amountLabel(shown.amount, shown.asset)}
          />
        </main>
        <BloomActions />
      </Screen>
    ),
    Concluded: ({ outcome, screen, received }) =>
      outcome === "AssetSettled" ? (
        <Screen>
          <ClaimHeader />
          <main
            data-testid="link-outcome"
            data-outcome={outcome}
            className="flex flex-1 flex-col px-5"
          >
            <BloomHero
              motion="flourish"
              label={m.receive_received()}
              amount={received}
            >
              <p className="text-body text-muted-foreground">
                {screen.message}
              </p>
            </BloomHero>
          </main>
          <BloomActions>
            <ResultLink link={<Link to="/home" />}>
              {m.receive_go_account()}
            </ResultLink>
          </BloomActions>
        </Screen>
      ) : (
        <Screen>
          <LinkResultScreen outcome={outcome} screen={screen}>
            {Match.value(screen.action).pipe(
              Match.when("home", () => (
                <ResultLink link={<Link to="/home" />}>
                  {m.receive_go_account()}
                </ResultLink>
              )),
              Match.when("again", () => (
                <ResultButton onClick={read}>{m.common_retry()}</ResultButton>
              )),
              Match.when("check", () => (
                <ResultButton onClick={read}>
                  {m.receive_check_again()}
                </ResultButton>
              )),
              Match.when("done", () => (
                <ResultLink link={<Link to="/" />}>
                  {m.receive_go_start()}
                </ResultLink>
              )),
              Match.exhaustive,
            )}
          </LinkResultScreen>
        </Screen>
      ),
  });
}

function ReceiveReview({
  sender,
  amount,
  network,
  problem,
  onConfirm,
}: {
  sender: string;
  amount: string;
  network?: string;
  problem: Option.Option<string>;
  onConfirm?: () => void;
}) {
  const ready = onConfirm !== undefined;

  return (
    <Screen>
      <ClaimHeader />
      <main
        data-testid={ready ? "receive-review" : undefined}
        aria-busy={!ready}
        className="flex flex-1 flex-col px-5"
      >
        <BloomHero
          motion="rest"
          label={m.receive_from({ username: sender })}
          amount={amount}
        >
          <div className="flex h-6 items-center">
            {network === undefined ? null : <NetworkBadge network={network} />}
          </div>
          <p className="text-body text-pretty text-muted-foreground">
            {m.receive_review_note()}
          </p>
          {Option.isSome(problem) ? (
            <p role="alert" className="text-body text-destructive">
              {problem.value}
            </p>
          ) : null}
        </BloomHero>
      </main>
      <BloomActions>
        <Button
          className="w-full"
          data-testid={ready ? "confirm-receive" : undefined}
          disabled={!ready}
          onClick={onConfirm}
        >
          {m.receive_with_passkey()}
        </Button>
      </BloomActions>
    </Screen>
  );
}

function ClaimHeader({ action }: { action?: React.ReactNode }) {
  return (
    <header className="flex h-14 items-center gap-2 px-3">
      <div className="flex-1" />
      <BrandLogo />
      <div className="flex flex-1 justify-end">{action}</div>
    </header>
  );
}
