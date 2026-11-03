import { RuleTester } from "oxlint/plugins-dev";

import { noFunctionsInWorkletsRule } from "./no-functions-in-worklets.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "nestedFunction" };

tester.run("worklets/no-functions-in-worklets", noFunctionsInWorkletsRule, {
  valid: [
    "const style = useAnimatedStyle(() => ({ opacity: progress.get() }));",
    "const stops = useMemo(() => colors.map((_, index) => index), [colors]);",
    "const style = useAnimatedStyle(() => ({ color: interpolateColor(progress.get(), stops, colors) }));",
    "function point(x: number) { 'worklet'; return x * 2; }",
    "const shoulder = (x: number) => { 'worklet'; const map = (y: number) => x + y; return map(2); };",
    "const style = useAnimatedStyle(() => { const scale = (x: number) => { 'worklet'; return x * 2; }; return { width: scale(4) }; });",
    "const handler = () => colors.map((color) => color.toUpperCase());",
  ],
  invalid: [
    {
      code: "const style = useAnimatedStyle(() => ({ color: interpolateColor(progress.get(), colors.map((_, index) => index), colors) }));",
      errors: [error],
    },
    {
      code: "const value = useDerivedValue(() => items.filter((item) => item.shown).length);",
      errors: [error],
    },
    {
      code: "function Card() { const point = (xs: number[]) => { 'worklet'; return xs.map(function (x) { return x * 2; }); }; return point; }",
      errors: [error],
    },
    {
      code: "useAnimatedReaction(() => list.get().map((item) => item.id), (ids) => ids.length);",
      errors: [error],
    },
  ],
});
