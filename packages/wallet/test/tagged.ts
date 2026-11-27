import * as Predicate from "effect/Predicate";

export function assertTagged<
  A extends { readonly _tag: string },
  const K extends A["_tag"],
>(value: A, tag: K): asserts value is Extract<A, { readonly _tag: K }> {
  if (!Predicate.isTagged(value, tag))
    throw new Error(`Expected ${tag}, got ${value._tag}`);
}
