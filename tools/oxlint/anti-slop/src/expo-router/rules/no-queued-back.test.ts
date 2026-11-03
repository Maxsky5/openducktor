import { RuleTester } from "oxlint/plugins-dev";

import { noQueuedBackRule } from "./no-queued-back.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const options = [{ closeHelper: "@/navigation/close-screen" }];
const error = { messageId: "queuedBack" };

tester.run("expo-router/no-queued-back", noQueuedBackRule, {
  valid: [
    { code: "closeScreen(navigation);", options },
    { code: "navigation.dispatchSync(StackActions.pop());", options },
    { code: "navigation.dispatch(StackActions.push('session'));", options },
    { code: "navigation.dispatchSync(CommonActions.goBack());", options },
    { code: "history.back();", options },
    { code: "router.push('/session');", options },
    { code: "items.pop();", options },
  ],
  invalid: [
    { code: "navigation.goBack();", options, errors: [error] },
    { code: "props.navigation.goBack();", options, errors: [error] },
    { code: "router.back();", options, errors: [error] },
    { code: "router.dismiss();", options, errors: [error] },
    { code: "navigation.pop();", options, errors: [error] },
    { code: "props.navigation.popTo('work/terminals');", options, errors: [error] },
    { code: "navigation.popToTop();", options, errors: [error] },
    { code: "navigation.dispatch(StackActions.pop(1));", options, errors: [error] },
    { code: "navigation.dispatch(StackActions.popTo('work/terminals'));", options, errors: [error] },
    { code: "navigation.dispatch(CommonActions.goBack());", options, errors: [error] },
  ],
});
