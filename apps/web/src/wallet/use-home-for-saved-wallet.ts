import { useEffect } from "react";
import { useNavigate, useRouteContext } from "@tanstack/react-router";
import * as Predicate from "effect/Predicate";

export function useHomeForSavedWallet() {
  const navigate = useNavigate();
  const { walletClient } = useRouteContext({ from: "__root__" });

  useEffect(() => {
    let current = true;

    void walletClient.saved().then((saved) => {
      if (current && Predicate.isTagged(saved, "SavedWallet"))
        void navigate({ to: "/home", replace: true });
    });

    return () => {
      current = false;
    };
  }, [walletClient, navigate]);
}
