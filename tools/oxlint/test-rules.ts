import { type ESTree, defineRule } from "@oxlint/plugins";

const method = (node: ESTree.Node) =>
  node.type === "MemberExpression" &&
  !node.computed &&
  node.property.type === "Identifier"
    ? node.property.name
    : undefined;

function testRegistration(node: ESTree.Node): boolean {
  if (node.type === "Identifier")
    return ["it", "test", "suite", "describe"].includes(node.name);

  return (
    node.type === "MemberExpression" &&
    ["effect", "live", "each", "only", "skip", "for"].includes(
      method(node) ?? "",
    ) &&
    testRegistration(node.object)
  );
}

const loops = new Set([
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
]);

export const noTestInLoop = defineRule({
  meta: {
    type: "problem",
    schema: [],
    messages: { loop: "Use a named parameterized case for each input." },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        if (!testRegistration(node.callee)) return;

        for (
          let ancestor = node.parent;
          ancestor.type !== "Program";
          ancestor = ancestor.parent
        ) {
          if (
            loops.has(ancestor.type) ||
            (ancestor.type === "CallExpression" &&
              method(ancestor.callee) === "forEach")
          ) {
            context.report({ node, messageId: "loop" });

            return;
          }
        }
      },
    };
  },
});

const staticText = (node?: ESTree.Node) =>
  (node?.type === "Literal" &&
    ["'", '"', "/"].includes(node.raw?.charAt(0) ?? "")) ||
  (node?.type === "TemplateLiteral" && node.expressions.length === 0);

export const noCopyLiteralInE2e = defineRule({
  meta: {
    type: "problem",
    schema: [],
    messages: { copy: "Locate the control by role or stable test ID." },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        const [first, options] = node.arguments;

        if (method(node.callee) === "getByText" && staticText(first))
          context.report({ node, messageId: "copy" });

        if (
          method(node.callee) !== "getByRole" ||
          options?.type !== "ObjectExpression"
        )
          return;

        for (const field of options.properties) {
          if (
            field.type === "Property" &&
            ((field.key.type === "Identifier" && field.key.name === "name") ||
              (field.key.type === "Literal" && field.key.value === "name")) &&
            staticText(field.value)
          )
            context.report({ node: field.value, messageId: "copy" });
        }
      },
    };
  },
});

function expectation(node: ESTree.Node): boolean {
  if (node.type === "MemberExpression") return expectation(node.object);

  return (
    node.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === "expect"
  );
}

export const noErrorMessageAssertion = defineRule({
  meta: {
    type: "problem",
    schema: [],
    messages: {
      message: "Assert the error type or domain tag that callers handle.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        const [value] = node.arguments;
        const callee = node.callee;

        if (
          callee.type === "Identifier" &&
          callee.name === "expect" &&
          value &&
          method(value) === "message"
        )
          context.report({ node, messageId: "message" });

        if (callee.type !== "MemberExpression" || !expectation(callee.object))
          return;

        if (
          (["toThrow", "toThrowError"].includes(method(callee) ?? "") &&
            staticText(value)) ||
          (method(callee) === "toHaveProperty" &&
            value?.type === "Literal" &&
            value.value === "message")
        )
          context.report({ node, messageId: "message" });
      },
    };
  },
});

export const noFilteredEffectTest = defineRule({
  meta: {
    type: "problem",
    schema: [],
    messages: { filtered: "Run every Effect test case." },
  },
  createOnce(context) {
    return {
      MemberExpression(node) {
        if (!["only", "skip", "skipIf", "runIf"].includes(method(node) ?? ""))
          return;

        if (
          ["effect", "live"].includes(method(node.object) ?? "") &&
          testRegistration(node.object)
        )
          context.report({ node, messageId: "filtered" });
      },
    };
  },
});
