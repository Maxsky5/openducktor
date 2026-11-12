import { splitInlineCode } from "@openducktor/frontend-core/lib/inline-code";
import { Fragment, type ReactElement } from "react";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { monoWeight } from "@/theme/tokens";

/**
 * Text with each value between backticks as inline code, as the desktop `InlineCodeText`. Render
 * it inside a `Text` that sets the font size and color.
 */
export function InlineCodeText({ text }: { text: string }): ReactElement {
  return (
    <>
      {splitInlineCode(text).map((part) =>
        part.code ? (
          // Nested text has no padding, so thin spaces keep the room around the code.
          <Text key={part.start} style={styles.code}>{` ${part.text} `}</Text>
        ) : (
          <Fragment key={part.start}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  // The desktop `INLINE_CODE_CLASS_NAME`: mono text in the foreground color on the muted fill.
  code: {
    ...monoWeight("regular"),
    fontStyle: "normal",
    color: theme.desktop.foreground,
    backgroundColor: theme.desktop.muted,
  },
}));
