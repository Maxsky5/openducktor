import { eslintCompatPlugin } from "@oxlint/plugins";

import { noFunctionsInWorkletsRule } from "./rules/no-functions-in-worklets.ts";

/** Opt-in Oxlint rules for worklet code that the React Compiler also compiles. */
const workletsPlugin = eslintCompatPlugin({
  meta: { name: "worklets" },
  rules: {
    "no-functions-in-worklets": noFunctionsInWorkletsRule,
  },
});

export default workletsPlugin;
