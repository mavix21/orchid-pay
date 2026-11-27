import { expect, it } from "@effect/vitest";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  ForbiddenCharacter,
  Username,
  UsernameTooLong,
  UsernameTooShort,
  usernameIssue,
} from "../src/contract";

it.each([
  ["maria-rojas!", new ForbiddenCharacter({ character: "-" })],
  ["Maria", new ForbiddenCharacter({ character: "M" })],
  ["ma", new UsernameTooShort({ length: 2 })],
  ["a".repeat(21), new UsernameTooLong({ length: 21 })],
])("refuses %j as a username", (typed, issue) => {
  expect(usernameIssue(typed)).toEqual(Option.some(issue));
  expect(Schema.is(Username)(typed)).toBe(false);
});

it("accepts lowercase letters, digits and underscores up to 20 characters", () => {
  expect(usernameIssue("maria_99")).toEqual(Option.none());
  expect(Schema.is(Username)("a".repeat(20))).toBe(true);
});
