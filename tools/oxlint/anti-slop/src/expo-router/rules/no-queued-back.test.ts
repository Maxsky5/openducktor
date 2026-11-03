import { RuleTester } from "oxlint/plugins-dev";

import { noQueuedBackRule } from "./no-queued-back.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "queuedBack" };

tester.run("expo-router/no-queued-back", noQueuedBackRule, {
  valid: [
    "closeScreen(navigation);",
    "navigation.dispatchSync(StackActions.pop());",
    "history.back();",
    "router.push('/session');",
  ],
  invalid: [
    { code: "navigation.goBack();", errors: [error] },
    { code: "router.back();", errors: [error] },
    { code: "props.navigation.goBack();", errors: [error] },
  ],
});
