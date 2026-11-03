import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

type Options = { closeHelper: string };

const isOptions = (option: unknown): option is Options =>
  option !== null &&
  typeof option === "object" &&
  "closeHelper" in option &&
  typeof option.closeHelper === "string";

const ROUTER_BACK = new Set(["back", "dismiss", "dismissAll", "dismissTo"]);
const NAVIGATION_POP = new Set(["pop", "popTo", "popToTop"]);
const STACK_POP = new Set(["pop", "popTo", "popToTop"]);

const propertyName = (node: ESTree.Node): string | null =>
  node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier"
    ? node.property.name
    : null;

/** The name of a call target such as `navigation` in `navigation.pop()` or `props.navigation.pop()`. */
const objectName = (node: ESTree.Node): string | null => {
  if (node.type !== "MemberExpression") return null;
  const { object } = node;
  if (object.type === "Identifier") return object.name;
  return propertyName(object);
};

/** A back action that `dispatch` queues: `StackActions.pop()` and its variants, or `CommonActions.goBack()`. */
const isBackAction = (node: ESTree.Node | undefined): boolean => {
  if (node?.type !== "CallExpression") return false;
  const action = propertyName(node.callee);
  const creator = objectName(node.callee);
  return (
    (creator === "StackActions" && action !== null && STACK_POP.has(action)) ||
    (creator === "CommonActions" && action === "goBack")
  );
};

/**
 * Expo Router sends `goBack`, `router.back`, the `pop` helpers, and `dispatch` through its routing
 * queue. The queue adds a render and a scan of the whole tree before the screen can close, so a
 * close starts late.
 */
export const noQueuedBackRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid back and pop calls that close a screen through the routing queue of Expo Router.",
    },
    messages: {
      queuedBack:
        "Close the screen with `closeScreen(navigation)` from `{{closeHelper}}`. This call waits for the routing queue of Expo Router, which adds a render and a scan of the whole tree before the screen closes.",
    },
    schema: [
      {
        type: "object",
        properties: { closeHelper: { type: "string" } },
        required: ["closeHelper"],
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const [option] = context.options;
    if (!isOptions(option)) {
      throw new Error(
        "expo-router/no-queued-back needs the closeHelper option. Set it in the rule entry of .oxlintrc.json.",
      );
    }
    const report = (node: ESTree.Node): void =>
      context.report({ node, messageId: "queuedBack", data: { closeHelper: option.closeHelper } });
    return {
      CallExpression(node) {
        const method = propertyName(node.callee);
        if (method === null) return;
        const target = objectName(node.callee);
        // `CommonActions.goBack()` only creates the action. Its `dispatch` call is the queued back.
        if (method === "goBack" && target !== "CommonActions") return report(node);
        if (target === "router" && ROUTER_BACK.has(method)) return report(node);
        if (target === "navigation" && NAVIGATION_POP.has(method)) return report(node);
        if (method === "dispatch" && isBackAction(node.arguments[0])) report(node);
      },
    };
  },
});
