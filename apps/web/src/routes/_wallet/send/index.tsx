import { XIcon } from "lucide-react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { type Holding } from "@workspace/wallet";
import * as Match from "effect/Match";

import { OptionRow } from "@/components/option-row";
import { Screen, ScreenActions } from "@/components/screen";
import { TokenIcon } from "@/components/token-icon";
import { TopNav } from "@/components/top-nav";
import { amountLabel } from "@/send/money";
import { SendUnavailable } from "@/send/send-unavailable";
import { shownOverview } from "@/wallet/shown-overview";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_wallet/send/")({
  ssr: false,
  pendingMs: 0,
  pendingComponent: () => <ChooseAssetFrame loading />,
  loader: async ({ context }) => {
    return shownOverview(await context.walletClient.overview());
  },
  component: ChooseAsset,
});

function ChooseAssetFrame({
  loading = false,
  children,
}: {
  loading?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Screen>
      <TopNav
        title={m.common_send()}
        label={m.common_close()}
        icon={<XIcon absoluteStrokeWidth />}
        link={<Link to="/home" />}
      />
      {loading ? (
        <div
          aria-label={m.send_loading_balances()}
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

function ChooseAsset() {
  const overview = Route.useLoaderData();

  return (
    <ChooseAssetFrame>
      {Match.valueTags(overview, {
        Holding: (holding) => <AssetChoices holding={holding} />,
        NeedsReopening: (unavailable) => (
          <SendUnavailable overview={unavailable} />
        ),
        InvalidAddress: (unavailable) => (
          <SendUnavailable overview={unavailable} />
        ),
        UnsupportedDevice: (unavailable) => (
          <SendUnavailable overview={unavailable} />
        ),
        Offline: (unavailable) => <SendUnavailable overview={unavailable} />,
        ServerUnreachable: (unavailable) => (
          <SendUnavailable overview={unavailable} />
        ),
        LedgerUnreachable: (unavailable) => (
          <SendUnavailable overview={unavailable} />
        ),
        ServiceFailed: (unavailable) => (
          <SendUnavailable overview={unavailable} />
        ),
        SessionRequired: (unavailable) => (
          <SendUnavailable overview={unavailable} />
        ),
        RateLimited: (unavailable) => (
          <SendUnavailable overview={unavailable} />
        ),
        InvalidResponse: (unavailable) => (
          <SendUnavailable overview={unavailable} />
        ),
      })}
    </ChooseAssetFrame>
  );
}

function AssetChoices({ holding }: { holding: Holding }) {
  const held = holding.balances.filter((balance) => balance.amount > 0n);

  return (
    <>
      <main className="flex flex-1 flex-col gap-6 px-5 pt-2">
        <h1 className="font-display text-h1">{m.send_choose_asset()}</h1>
        {held.length === 0 ? (
          <p className="text-body text-muted-foreground">
            {m.send_no_balance()}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {held.map((balance) => (
              <OptionRow
                key={balance.asset.id}
                title={balance.asset.code}
                description={amountLabel(balance.amount, balance.asset)}
                media={<TokenIcon asset={balance.asset} />}
                mediaVariant="muted"
                render={
                  <Link
                    data-testid={`send-asset-${balance.asset.id}`}
                    to="/send/$asset"
                    params={{ asset: balance.asset.id }}
                  />
                }
              />
            ))}
          </div>
        )}
      </main>
      <ScreenActions>
        <Button
          className="w-full"
          variant="secondary"
          nativeButton={false}
          render={<Link to="/links" data-testid="open-links" />}
        >
          {m.send_view_links()}
        </Button>
      </ScreenActions>
    </>
  );
}
