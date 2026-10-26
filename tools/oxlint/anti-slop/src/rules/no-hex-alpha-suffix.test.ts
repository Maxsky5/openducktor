import { RuleTester } from "oxlint/plugins-dev";

import { noHexAlphaSuffixRule } from "./no-hex-alpha-suffix.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "tsx" } } });
const error = (suffix: string) => ({ messageId: "hexAlphaSuffix", data: { suffix } });

tester.run("anti-slop/no-hex-alpha-suffix", noHexAlphaSuffixRule, {
  valid: [
    "const color = withAlpha(theme.colors.tint, 0.25);",
    "const color = `${theme.colors.tint}`;",
    "const label = `${count}px`;",
    "const label = `${count}abc`;",
    "const label = `${count}4`;",
    "const label = `#${hex}40`;",
    "const label = `${red}${green}40`;",
    "const color = '#5100ff40';",
    "type Hex = `${string}40`;",
    "const width = `${size}50%`;",
    "const shadow = `0 0 ${blur}10px`;",
  ],
  invalid: [
    { name: "lower case", code: "const color = `${theme.colors.tint}4d`;", errors: [error("4d")] },
    {
      name: "upper case",
      code: "const color = `${theme.desktop.secondary}B3`;",
      errors: [error("B3")],
    },
    {
      name: "digits only",
      code: "const style = { borderColor: `${color}80` };",
      errors: [error("80")],
    },
    {
      name: "JSX attribute",
      code: "const ring = <Circle stroke={`${theme.desktop.foreground}26`} />;",
      errors: [error("26")],
    },
    {
      name: "CSS value with two colors",
      code: "const shadow = `0 0 0 1px ${border}b8, 0 0 18px ${ring}4d`;",
      errors: [error("b8"), error("4d")],
    },
    {
      name: "gradient stop",
      code: "const fill = `radial-gradient(circle, ${tint}40, ${tint}00)`;",
      errors: [error("40"), error("00")],
    },
  ],
});
