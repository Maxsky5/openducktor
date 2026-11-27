import { RuleTester } from "oxlint/plugins-dev";

import { noTransparentTextColorRule } from "./no-transparent-text-color.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "tsx" } } });
const error = (value: string) => ({ messageId: "zeroTextColor", data: { value } });

tester.run("anti-slop/no-transparent-text-color", noTransparentTextColorRule, {
  valid: [
    'const style = { color: "rgba(255, 255, 255, 0)" };',
    "const style = { color: theme.colors.label };",
    'const style = { backgroundColor: "transparent", borderColor: "transparent" };',
    'const icon = <Icon colorValue="#ffffff00" />;',
    'const style = { ["color"]: "transparent" };',
  ],
  invalid: [
    {
      name: "style key",
      code: 'const style = { color: "transparent" };',
      errors: [error("transparent")],
    },
    {
      name: "quoted style key",
      code: 'const style = { "color": "#00000000" };',
      errors: [error("#00000000")],
    },
    {
      name: "black with zero alpha",
      code: "const style = { color: 'rgba(0, 0, 0, 0)' };",
      errors: [error("rgba(0, 0, 0, 0)")],
    },
    {
      name: "icon prop",
      code: 'const icon = <Icon colorValue="transparent" />;',
      errors: [error("transparent")],
    },
    {
      name: "expression container",
      code: 'const text = <Text color={"#0000"} />;',
      errors: [error("#0000")],
    },
  ],
});
