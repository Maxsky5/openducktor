import { memo, type ReactElement, useMemo } from "react";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { HighlightedLine } from "@/rich-content/code/highlight";
import { type CharRange, codeSegments } from "./code-segments";
import { PIERRE_COLORS } from "./pierre-colors";

/**
 * The tokens of one highlighted line in the desktop syntax colors, for use inside a monospaced
 * `Text`. `emphasis` washes the changed words of a changed diff line.
 */
export const PierreCodeTokens = memo(function PierreCodeTokens({
  tokens,
  emphasis = null,
  change = "add",
}: {
  tokens: HighlightedLine;
  emphasis?: CharRange | null | undefined;
  /** The change of the line, which sets the color of the emphasis wash. */
  change?: "add" | "delete" | undefined;
}): ReactElement {
  const segments = useMemo(() => codeSegments(tokens, emphasis), [emphasis, tokens]);
  return (
    <>
      {segments.map((segment, index) => (
        // The segments of a line never change order, so the index is a stable key.
        <Text
          // react-doctor-disable-next-line react-doctor/no-array-index-as-key
          key={index}
          style={[
            toneStyles[segment.tone],
            segment.emphasized
              ? change === "add"
                ? toneStyles.additionEmphasis
                : toneStyles.deletionEmphasis
              : null,
          ]}
        >
          {segment.text}
        </Text>
      ))}
    </>
  );
});

const toneStyles = StyleSheet.create((theme) => ({
  plain: { color: PIERRE_COLORS[theme.scheme].syntax.plain },
  comment: { color: PIERRE_COLORS[theme.scheme].syntax.comment },
  keyword: { color: PIERRE_COLORS[theme.scheme].syntax.keyword },
  string: { color: PIERRE_COLORS[theme.scheme].syntax.string },
  number: { color: PIERRE_COLORS[theme.scheme].syntax.number },
  function: { color: PIERRE_COLORS[theme.scheme].syntax.function },
  type: { color: PIERRE_COLORS[theme.scheme].syntax.type },
  tag: { color: PIERRE_COLORS[theme.scheme].syntax.tag },
  attribute: { color: PIERRE_COLORS[theme.scheme].syntax.attribute },
  punctuation: { color: PIERRE_COLORS[theme.scheme].syntax.punctuation },
  variable: { color: PIERRE_COLORS[theme.scheme].syntax.variable },
  inserted: { color: PIERRE_COLORS[theme.scheme].syntax.inserted },
  deleted: { color: PIERRE_COLORS[theme.scheme].syntax.deleted },
  additionEmphasis: { backgroundColor: PIERRE_COLORS[theme.scheme].additionEmphasis },
  deletionEmphasis: { backgroundColor: PIERRE_COLORS[theme.scheme].deletionEmphasis },
}));
