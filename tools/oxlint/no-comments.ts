import { definePlugin, defineRule } from "@oxlint/plugins";

import {
  noTestInLoop,
  noCopyLiteralInE2e,
  noErrorMessageAssertion,
  noFilteredEffectTest,
} from "./test-rules.ts";

export default definePlugin({
  meta: { name: "orchid" },
  rules: {
    "no-filtered-effect-test": noFilteredEffectTest,
    "no-test-in-loop": noTestInLoop,
    "no-copy-literal-in-e2e": noCopyLiteralInE2e,
    "no-error-message-assertion": noErrorMessageAssertion,
    "no-comments": defineRule({
      meta: {
        type: "problem",
        schema: [],
        messages: {
          forbidden:
            "Remove this comment. Express meaning through clear names, domain terminology, and code structure.",
        },
      },
      createOnce(context) {
        return {
          Program() {
            for (const comment of context.sourceCode.getAllComments()) {
              context.report({ loc: comment.loc, messageId: "forbidden" });
            }
          },
        };
      },
    }),
  },
});
