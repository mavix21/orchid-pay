import * as React from "react";

const MOBILE_BREAKPOINT = 768;

const mobileQuery = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

function subscribeToViewport(onViewportChange: () => void) {
  const media = window.matchMedia(mobileQuery);

  media.addEventListener("change", onViewportChange);

  return () => media.removeEventListener("change", onViewportChange);
}

const viewportIsMobile = () => window.matchMedia(mobileQuery).matches;

const serverAssumesMobile = () => true;

export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribeToViewport,
    viewportIsMobile,
    serverAssumesMobile,
  );
}
