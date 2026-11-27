import { HumanCheckToken } from "@workspace/wallet";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export type HumanCheckStatus =
  | "waiting"
  | "interactive"
  | "ready"
  | "unavailable";

const decodeToken = Schema.decodeUnknownOption(HumanCheckToken);

const tokenWaitMillis = 10_000;

let held = Option.none<HumanCheckToken>();
let status: HumanCheckStatus = "waiting";
let mounted = 0;

const changes = new Set<() => void>();
const takes = new Set<() => void>();
const watchers = new Set<() => void>();

const settle = (listeners: Set<() => void>) => {
  for (const listener of listeners) listener();
};

const become = (next: HumanCheckStatus) => {
  status = next;
  settle(watchers);
};

export const humanCheckStatus = () => status;

export const watchHumanCheck = (listener: () => void) => {
  watchers.add(listener);

  return () => {
    watchers.delete(listener);
  };
};

export const offerHumanCheck = (text: string) => {
  held = decodeToken(text);
  settle(changes);
  become(Option.isSome(held) ? "ready" : "unavailable");
};

export const expireHumanCheck = () => {
  held = Option.none();
  become("waiting");
};

export const interactHumanCheck = () => {
  if (Option.isNone(held)) become("interactive");
};

export const failHumanCheck = () => {
  held = Option.none();
  settle(changes);
  become("unavailable");
};

export const mountHumanCheck = () => {
  let active = true;

  mounted += 1;
  become("waiting");

  return () => {
    if (!active) return;

    active = false;
    mounted -= 1;
    held = Option.none();
    settle(changes);
    become("waiting");
  };
};

export const onHumanCheckTaken = (listener: () => void) => {
  takes.add(listener);

  return () => {
    takes.delete(listener);
  };
};

const change = () =>
  new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      changes.delete(finish);
      resolve();
    };

    const timer = setTimeout(finish, tokenWaitMillis);

    changes.add(finish);
  });

export const takeHumanCheck = async (): Promise<
  Option.Option<HumanCheckToken>
> => {
  if (Option.isNone(held) && mounted > 0 && status !== "unavailable")
    await change();

  const taken = held;

  if (Option.isSome(taken)) {
    held = Option.none();
    become("waiting");
    settle(takes);
  }

  return taken;
};
