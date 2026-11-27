import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";

export const pendingSteps = 12;
export const pendingPause = "2 seconds";

export const pollSchedule = <A>(
  shouldContinue: (step: A) => boolean,
  shouldPause: (step: A) => boolean,
) =>
  Schedule.spaced(pendingPause).pipe(
    Schedule.upTo({ times: pendingSteps - 1 }),
    Schedule.while(({ input }: Schedule.Metadata<number, A>) =>
      shouldContinue(input),
    ),
    Schedule.modifyDelay(({ input, duration }) =>
      Effect.succeed(shouldPause(input) ? duration : Duration.zero),
    ),
  );
