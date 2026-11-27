import * as Effect from "effect/Effect";
import { Offline, ServerUnreachable } from "../contract";

export const unreachedServer = () =>
  typeof navigator !== "undefined" && !navigator.onLine
    ? new Offline()
    : new ServerUnreachable();

export const loadFromServer = <A>(load: () => Promise<A>) =>
  Effect.tryPromise({ try: load, catch: unreachedServer });
