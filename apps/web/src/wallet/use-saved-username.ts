import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";

import { useWalletTask } from "@/send/use-wallet-task";
import { walletEffects } from "@/wallet";

type SavedUsername = {
  readonly read: boolean;
  readonly username: Option.Option<string>;
};

export function useSavedUsername() {
  const task = useWalletTask();

  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  const [saved, setSaved] = useState<SavedUsername>({
    read: false,
    username: Option.none(),
  });

  useEffect(() => {
    task.run(walletEffects.saved(), (answer) =>
      setSaved({
        read: true,
        username: Predicate.isTagged(answer, "SavedWallet")
          ? Option.some(answer.username)
          : Option.none(),
      }),
    );
  }, [pathname]);

  return saved;
}
