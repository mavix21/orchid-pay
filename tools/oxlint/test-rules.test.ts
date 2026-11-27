import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";

import {
  noCopyLiteralInE2e,
  noErrorMessageAssertion,
  noFilteredEffectTest,
  noTestInLoop,
} from "./test-rules.ts";

RuleTester.describe = describe;

RuleTester.it = it;

const tester = new RuleTester();

tester.run("no-test-in-loop", noTestInLoop, {
  valid: [
    'it.effect.each(mismatches)("refuses %s", check)',
    'it("replays", () => { for (const order of orders) submit(order) })',
  ],
  invalid: [
    {
      code: "for (const failure of unavailableAnswers) it.effect(failure._tag, check)",
      errors: [{ messageId: "loop" }],
    },
  ],
});

tester.run("no-copy-literal-in-e2e", noCopyLiteralInE2e, {
  valid: ['page.getByRole("alert")', "page.getByText(username)"],
  invalid: [
    {
      code: 'page.getByRole("button", { name: "Continuar" })',
      errors: [{ messageId: "copy" }],
    },
    { code: 'page.getByText("Sin conexión")', errors: [{ messageId: "copy" }] },
  ],
});

tester.run("no-error-message-assertion", noErrorMessageAssertion, {
  valid: [
    "expect(parse).toThrow(TypeError)",
    'expect(failure._tag).toBe("Offline")',
  ],
  invalid: [
    {
      code: 'expect(parse).toThrow("Invalid address")',
      errors: [{ messageId: "message" }],
    },
    {
      code: "expect(request).rejects.toThrow(/network/)",
      errors: [{ messageId: "message" }],
    },
    {
      code: "expect(error.message).toBe(detail)",
      errors: [{ messageId: "message" }],
    },
  ],
});

tester.run("no-filtered-effect-test", noFilteredEffectTest, {
  valid: ['it.effect("replays", check)'],
  invalid: [
    {
      code: 'it.effect.only("replays", check)',
      errors: [{ messageId: "filtered" }],
    },
    {
      code: 'it.live.skip("replays", check)',
      errors: [{ messageId: "filtered" }],
    },
  ],
});
