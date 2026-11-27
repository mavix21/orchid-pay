import {
  type EnrollmentClient,
  type EnrollmentEffects,
  loadFromServer,
} from "@workspace/wallet";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

const loaded = loadFromServer(() => import("./enrollment-client")).pipe(
  Effect.map((client) => client.enrollmentEffects),
);

const withEnrollment = <A>(
  use: (enrollment: EnrollmentEffects) => Effect.Effect<A>,
) =>
  loaded.pipe(
    Effect.flatMap(use),
    Effect.catch((failure) => Effect.succeed(failure)),
  );

export const enrollmentEffects: EnrollmentEffects = {
  pending: () =>
    loaded.pipe(
      Effect.flatMap((enrollment) => enrollment.pending()),
      Effect.orElseSucceed(() => Option.none()),
    ),
  start: (usernameText) =>
    withEnrollment((enrollment) => enrollment.start(usernameText)),
  advance: (shown, receive, committing) =>
    withEnrollment((enrollment) =>
      enrollment.advance(shown, receive, committing),
    ),
  reviewReceive: (code) =>
    withEnrollment((enrollment) => enrollment.reviewReceive(code)),
  discard: () =>
    loaded.pipe(
      Effect.flatMap((enrollment) => enrollment.discard()),
      Effect.orElseSucceed(() => false),
    ),
};

export const enrollmentClient: EnrollmentClient = {
  pending: () => Effect.runPromise(enrollmentEffects.pending()),
  start: (usernameText) =>
    Effect.runPromise(enrollmentEffects.start(usernameText)),
  advance: (shown, receive, onCommitting) =>
    Effect.runPromise(
      enrollmentEffects.advance(
        shown,
        receive,
        onCommitting === undefined ? Effect.void : Effect.sync(onCommitting),
      ),
    ),
  reviewReceive: (code) =>
    Effect.runPromise(enrollmentEffects.reviewReceive(code)),
  discard: () => Effect.runPromise(enrollmentEffects.discard()),
};
