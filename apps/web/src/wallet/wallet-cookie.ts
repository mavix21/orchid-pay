import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";

const walletCookie = "orchid-wallet";

export const deviceHoldsWallet = createIsomorphicFn()
  .server(() => getCookie(walletCookie) === "1")
  .client(() => document.cookie.split("; ").includes(`${walletCookie}=1`));

export function markWalletOnDevice(held: boolean) {
  document.cookie = held
    ? `${walletCookie}=1; Path=/; Max-Age=31536000; SameSite=Lax`
    : `${walletCookie}=; Path=/; Max-Age=0; SameSite=Lax`;
}
