import { eslintCompatPlugin } from "@oxlint/plugins";

import { noQueuedBackRule } from "./rules/no-queued-back.ts";

/** Opt-in Oxlint rules for the navigation calls of Expo Router apps. */
const expoRouterPlugin = eslintCompatPlugin({
  meta: { name: "expo-router" },
  rules: {
    "no-queued-back": noQueuedBackRule,
  },
});

export default expoRouterPlugin;
