import { RuleTester } from "oxlint/plugins-dev";

import { noThemedColorsOnUnboundComponentsRule } from "./no-themed-colors-on-unbound-components.ts";

const tester = new RuleTester();
const filename = "src/screen.tsx";
const options = [
  { boundModules: ["react-native", "react-native-reanimated"], appPrefixes: ["@/"] },
];
const error = { messageId: "themedColor" };
const forwarded = { messageId: "forwardedStyle" };

const sheet = `
import { FlatList, View } from "react-native";
import Animated from "react-native-reanimated";
import { FlashList } from "@shopify/flash-list";
import { GestureHandlerRootView, Touchable } from "react-native-gesture-handler";
import { withUnistyles } from "react-native-unistyles";
import { Card } from "@/ui/card";
import { Row } from "./row";
const styles = StyleSheet.create((theme, rt) => ({
  page: { flex: 1, backgroundColor: theme.colors.background },
  wash: { variants: { tone: { add: { backgroundColor: theme.colors.add } } } },
  gutter: (digits: number) => ({ borderColor: theme.colors.border, width: digits }),
  scaled: { borderColor: rt.colorScheme === "dark" ? "#000" : "#fff" },
  content: { paddingBottom: theme.space.xl },
  fixed: { backgroundColor: "#fff" },
  raised: { boxShadow: theme.shadows.card },
}));`;

tester.run("unistyles/no-themed-colors-on-unbound-components", noThemedColorsOnUnboundComponentsRule, {
  valid: [
    { code: `${sheet}\nconst a = <FlashList contentContainerStyle={styles.content} />;`, options, filename },
    { code: `${sheet}\nconst a = <FlashList style={styles.fixed} />;`, options, filename },
    { code: `${sheet}\nconst a = <View style={styles.page}><FlashList /></View>;`, options, filename },
    { code: `${sheet}\nconst a = <FlatList style={styles.page} />;`, options, filename },
    { code: `${sheet}\nconst a = <Animated.View style={styles.page} />;`, options, filename },
    { code: `${sheet}\nconst a = <Card style={styles.page} />;`, options, filename },
    { code: `${sheet}\nconst a = <Row style={styles.page} />;`, options, filename },
    { code: `${sheet}\nconst Local = View;\nconst a = <Local style={styles.page} />;`, options, filename },
    {
      code: `${sheet}\nconst Bound = withUnistyles(Touchable);\nfunction Press({ style }) { return <Bound style={style} />; }`,
      options,
      filename,
    },
    {
      code: `${sheet}\nfunction Thumb({ width }) { return <FlashList style={{ width }} />; }`,
      options,
      filename,
    },
    { code: `${sheet}\nfunction Press({ style }) { return <View style={style} />; }`, options, filename },
  ],
  invalid: [
    { code: `${sheet}\nconst a = <FlashList style={styles.page} />;`, options, filename, errors: [error] },
    { code: `${sheet}\nconst a = <FlashList style={[styles.content, styles.wash]} />;`, options, filename, errors: [error] },
    { code: `${sheet}\nconst a = <FlashList contentContainerStyle={styles.gutter(2)} />;`, options, filename, errors: [error] },
    { code: `${sheet}\nconst a = <FlashList style={styles.scaled} />;`, options, filename, errors: [error] },
    {
      code: `${sheet}\nconst a = <GestureHandlerRootView style={styles.page} />;`,
      options,
      filename,
      errors: [error],
    },
    { code: `${sheet}\nconst a = <FlashList style={styles.raised} />;`, options, filename, errors: [error] },
    {
      code: `${sheet}\nfunction Press({ style, containerStyle }) { return <Touchable style={[containerStyle, style, styles.content]} />; }`,
      options,
      filename,
      errors: [forwarded, forwarded],
    },
    {
      code: `${sheet}\nconst List = ({ contentContainerStyle }) => <FlashList contentContainerStyle={contentContainerStyle} />;`,
      options,
      filename,
      errors: [forwarded],
    },
  ],
});

// A rule entry without options must fail the run, so a config mistake cannot turn the rule off.
const missingOptionsMessage = (() => {
  try {
    tester.run("unistyles/no-themed-colors-on-unbound-components", noThemedColorsOnUnboundComponentsRule, {
      valid: [{ code: `${sheet}\nconst a = <FlashList style={styles.page} />;`, filename }],
      invalid: [],
    });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "no error";
})();
if (!missingOptionsMessage.includes("needs the boundModules and appPrefixes options")) {
  throw new Error(`The rule must fail without its options, but it gave: ${missingOptionsMessage}`);
}
