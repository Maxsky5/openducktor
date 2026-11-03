import { defineRule } from "@oxlint/plugins";

/**
 * `goBack()` and `router.back()` go through the routing queue of Expo Router. The queue adds a
 * render and a scan of the whole tree before the screen can close, so a close starts late.
 */
export const noQueuedBackRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid goBack() and router.back(), which close a screen through the routing queue of Expo Router.",
    },
    messages: {
      queuedBack:
        "Close the screen with `closeScreen(navigation)` from `@/navigation/close-screen`. `goBack()` and `router.back()` wait for the routing queue of Expo Router, which adds a render and a scan of the whole tree before the screen closes.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        const { callee } = node;
        if (callee.type !== "MemberExpression" || callee.computed) return;
        if (callee.property.type !== "Identifier") return;
        const name = callee.property.name;
        const isRouterBack =
          name === "back" && callee.object.type === "Identifier" && callee.object.name === "router";
        if (name === "goBack" || isRouterBack) context.report({ node, messageId: "queuedBack" });
      },
    };
  },
});
