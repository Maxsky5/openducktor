import { memo, type ReactElement, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { type HighlightedLine, plainLineText } from "@/rich-content/code/highlight";
import {
  CODE_FONT_SIZE,
  CODE_LINE_HEIGHT,
  codeCharWidth,
  PIERRE_COLORS,
} from "@/rich-content/diff/pierre-colors";
import { PierreCodeTokens } from "@/rich-content/diff/pierre-code-tokens";

/**
 * One line of the desktop code view: the line number in a column of `numberChars` monospaced
 * characters, then the code in the desktop syntax colors. Long lines wrap, so the list scrolls
 * only up and down.
 */
export const CodeLineRow = memo(function CodeLineRow({
  tokens,
  lineNumber,
  numberChars,
}: {
  /** Read them with `highlightLines(code, language).line(index)` in the list row. */
  tokens: HighlightedLine;
  lineNumber: number;
  /** The width of the number column in characters. Give every row of a file the same width. */
  numberChars: number;
}): ReactElement {
  // A line without highlight, as each line of a file over the highlight limit, is one plain
  // token. The code text shows it in the plain syntax color, with no nested text per token.
  const plainText = plainLineText(tokens);
  const text = plainText ?? tokens.map((token) => token.text).join("");
  // A recycled row keeps the column style while the width stays, so a scroll does not build it
  // again for each line.
  const numberWidth = useMemo(() => styles.numberWidth(numberChars), [numberChars]);
  return (
    <View style={styles.row} accessible accessibilityLabel={`Line ${lineNumber}: ${text}`}>
      <Text style={[styles.code, styles.number, numberWidth]}>{lineNumber}</Text>
      <Text style={[styles.code, styles.content]}>
        {plainText ?? <PierreCodeTokens tokens={tokens} />}
      </Text>
    </View>
  );
});

/** The space between the number column and the code, as the desktop gutter border. */
const GUTTER_GAP = 2;

const styles = StyleSheet.create((theme, rt) => ({
  row: { flexDirection: "row" },
  code: {
    fontFamily: theme.fonts.mono.regular,
    fontSize: CODE_FONT_SIZE,
    lineHeight: CODE_LINE_HEIGHT,
    color: PIERRE_COLORS[theme.scheme].foreground,
  },
  number: { textAlign: "right", color: PIERRE_COLORS[theme.scheme].lineNumber },
  // The desktop column pads the number by half a character before and 0.75 after.
  numberWidth: (chars: number) => {
    const char = codeCharWidth(rt.fontScale);
    return {
      width: Math.ceil(chars * char) + GUTTER_GAP,
      paddingLeft: Math.round(char / 2),
      paddingRight: Math.round(char * 0.75) + GUTTER_GAP,
    };
  },
  content: { flex: 1, paddingHorizontal: Math.round(codeCharWidth(rt.fontScale)) },
}));
