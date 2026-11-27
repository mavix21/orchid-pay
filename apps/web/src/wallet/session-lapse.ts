import { useSyncExternalStore } from "react";

let lapsed = false;

const listeners = new Set<() => void>();

const set = (next: boolean) => {
  if (lapsed === next) return;

  lapsed = next;

  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

export const sessionLapse = {
  note: () => set(true),
  clear: () => set(false),
};

const lapsedOnServer = () => false;

export const useSessionLapsed = () =>
  useSyncExternalStore(subscribe, () => lapsed, lapsedOnServer);
