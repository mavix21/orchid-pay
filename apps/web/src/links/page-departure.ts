import { useEffect, useEffectEvent } from "react";

export const pageHidden = () => document.visibilityState === "hidden";

export function usePageDeparture(onHidden: () => void, onPageHide: () => void) {
  const hidden = useEffectEvent(onHidden);
  const pageHide = useEffectEvent(onPageHide);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (pageHidden()) hidden();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", pageHide);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", pageHide);
    };
  }, []);
}
