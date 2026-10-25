import { RuleTester } from "oxlint/plugins-dev";

import { noStylesheetDependencyAliasesRule } from "./no-stylesheet-dependency-aliases.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "indirectStyles" };

tester.run("unistyles/no-stylesheet-dependency-aliases", noStylesheetDependencyAliasesRule, {
  valid: [
    "const styles = StyleSheet.create((theme) => ({ text: { color: theme.colors.label } }));",
    "const styles = StyleSheet.create({ text: { color: 'red' } });",
    "const styles = StyleSheet.create((theme) => ({ gutter: (digits: number) => { const width = digits * theme.space.sm; return { width }; } }));",
    "const styles = other.create((theme) => { const text = theme.colors.label; return { text: { color: text } }; });",
  ],
  invalid: [
    {
      code: "const styles = StyleSheet.create((theme) => { const text = theme.colors.label; return { text: { color: text } }; });",
      errors: [error],
    },
    {
      code: "const styles = StyleSheet.create(function (theme) { function tone() { return theme.colors.label; } return { text: { color: tone() } }; });",
      errors: [error],
    },
    {
      code: "const styles = StyleSheet.create((theme) => { const pad = (n: number) => { return { padding: n }; }; return { box: { ...pad(4), color: theme.colors.label } }; });",
      errors: [error],
    },
    {
      code: "const styles = StyleSheet.create((theme) => buildStyles(theme));",
      errors: [error],
    },
  ],
});
