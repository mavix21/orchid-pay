import { useEffect, useRef } from "react";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export class DeviceFailure extends Schema.TaggedClass<DeviceFailure>()(
  "DeviceFailure",
  {},
) {}

export type Answer<A> = A | DeviceFailure;

export function useWalletTask() {
  const running = useRef<Option.Option<Fiber.Fiber<void>>>(Option.none());
  const latest = useRef(0);

  const stop = () => {
    latest.current += 1;

    if (Option.isSome(running.current))
      Effect.runFork(Fiber.interrupt(running.current.value));

    running.current = Option.none();
  };

  useEffect(() => stop, []);

  const run = <A>(
    effect: Effect.Effect<A>,
    onAnswer: (answer: Answer<A>) => void,
  ) => {
    stop();

    const ticket = latest.current;

    running.current = Option.some(
      Effect.runFork(
        effect.pipe(
          Effect.exit,
          Effect.flatMap((exit) =>
            Effect.sync(() => {
              if (latest.current === ticket)
                onAnswer(
                  Exit.isSuccess(exit) ? exit.value : new DeviceFailure(),
                );
            }),
          ),
        ),
      ),
    );
  };

  return { run, stop };
}
