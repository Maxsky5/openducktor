import { memo, type ReactElement } from "react";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { OneHighlightedLine } from "./highlight";
import { ONE_THEME_COLORS } from "./one-theme";

/** The tokens of one line in the desktop One Light or One Dark theme, for a Markdown code block. */
export const OneCodeTokens = memo(function OneCodeTokens({
  tokens,
}: {
  tokens: OneHighlightedLine;
}): ReactElement {
  return (
    <>
      {tokens.map((token, index) =>
        // The token list of a line never changes, so the index is a stable key. Base text takes
        // the block color.
        token.tone === "base" ? (
          token.text
        ) : (
          // react-doctor-disable-next-line react-doctor/no-array-index-as-key
          <Text key={index} style={oneStyles[token.tone]}>
            {token.text}
          </Text>
        ),
      )}
    </>
  );
});

const oneStyles = StyleSheet.create((theme) => ({
  comment: { color: ONE_THEME_COLORS[theme.scheme].comment, fontStyle: "italic" },
  orange: { color: ONE_THEME_COLORS[theme.scheme].orange },
  purple: { color: ONE_THEME_COLORS[theme.scheme].purple },
  red: { color: ONE_THEME_COLORS[theme.scheme].red },
  green: { color: ONE_THEME_COLORS[theme.scheme].green },
  blue: { color: ONE_THEME_COLORS[theme.scheme].blue },
  cyan: { color: ONE_THEME_COLORS[theme.scheme].cyan },
}));
