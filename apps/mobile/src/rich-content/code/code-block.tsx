import { Fragment, memo, type ReactElement, useCallback, useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useClipboardCopy } from "@/platform/use-clipboard-copy";
import { useAppTheme } from "@/theme/app-theme-context";
import { Icon } from "@/ui/icon";
import { Touchable } from "@/ui/touchable";
import { OneCodeTokens } from "./code-tokens";
import { highlightOneLines } from "./highlight";
import { ONE_THEME_COLORS } from "./one-theme";

export type CodeBlockProps = {
  code: string;
  /** A fence info string or language name. An unknown language shows plain text. */
  language?: string | null | undefined;
  showLineNumbers?: boolean | undefined;
  /** Shows the copy button. The code goes to the clipboard only when the user presses it. */
  copyable?: boolean | undefined;
  /** Shows the code without highlighting, as the desktop chat and a fence that still streams. */
  plain?: boolean | undefined;
  /** `compact` is the smaller code of the desktop `compact` Markdown variant. */
  variant?: "document" | "compact" | undefined;
};

/**
 * A code block as the desktop Markdown: a rounded outlined box on a light muted wash. Plain code
 * is the desktop chat `pre > code` in the foreground color. Highlighted code is the desktop
 * `markdown-syntax-block.tsx` in the One Light and One Dark themes. The box scrolls sideways.
 * The phone has no hover or easy selection, so a slim top bar holds the language and a copy
 * button; a button over the code would hide the end of the first line. All lines render in one
 * `Text`, which costs less than one view per line. For a long file, use `CodeLineRow` rows of
 * `features/files/code-line-row.tsx` in a list.
 */
export const CodeBlock = memo(function CodeBlock({
  code,
  language,
  showLineNumbers = false,
  copyable = true,
  plain = false,
  variant = "document",
}: CodeBlockProps): ReactElement {
  const theme = useAppTheme();
  const { copyText } = useClipboardCopy();
  const highlighted = useMemo(
    () => (plain ? null : highlightOneLines(code, language)),
    [code, language, plain],
  );
  // Unknown languages show as plain code in the desktop foreground, as the desktop fallback.
  const lines = useMemo(
    () =>
      highlighted === null || highlighted.language === null
        ? null
        : Array.from({ length: highlighted.lineCount }, (_, index) => highlighted.line(index)),
    [highlighted],
  );
  const lineNumbers = useMemo(() => {
    if (!showLineNumbers) return null;
    const lineCount = highlighted?.lineCount ?? code.split("\n").length;
    return Array.from({ length: lineCount }, (_, index) => String(index + 1)).join("\n");
  }, [code, highlighted, showLineNumbers]);
  const copy = useCallback(() => {
    void copyText(code, { copied: "Code copied.", failed: "The code was not copied." });
  }, [code, copyText]);
  const syntax = lines !== null;
  const compact = variant === "compact";
  // A transcript renders many code blocks, so a block picks plain style entries instead of
  // stylesheet variants, which run native code on each render.
  const look = syntax
    ? compact
      ? styles.syntaxCompactCode
      : styles.syntaxCode
    : compact
      ? styles.plainCompactCode
      : styles.plainCode;
  const topSpace = copyable ? styles.belowHeader : null;

  return (
    <View style={styles.block}>
      {copyable ? (
        <View style={styles.header}>
          <Text style={styles.language} numberOfLines={1}>
            {highlighted?.language ?? language ?? ""}
          </Text>
          <Touchable
            feedback="opacity"
            radius={theme.radius.md}
            onPress={copy}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Copy code"
            style={styles.copy}
          >
            <Icon name="copy" size={14} colorValue={theme.desktop.mutedForeground} />
          </Touchable>
        </View>
      ) : null}
      <View style={styles.body}>
        {lineNumbers === null ? null : (
          <Text
            style={[
              styles.code,
              look,
              styles.gutter,
              syntax ? styles.syntaxGutter : styles.plainGutter,
              topSpace,
            ]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {lineNumbers}
          </Text>
        )}
        <ScrollView
          horizontal
          contentContainerStyle={[
            styles.scrollContent,
            syntax ? styles.syntaxContent : styles.plainContent,
            topSpace,
          ]}
          style={styles.scroll}
          showsHorizontalScrollIndicator={false}
        >
          <Text style={[styles.code, look]} selectable>
            {lines === null
              ? code
              : lines.map((tokens, index) => (
                  // Lines keep their order, so the index is a stable key.
                  // react-doctor-disable-next-line react-doctor/no-array-index-as-key
                  <Fragment key={index}>
                    {index > 0 ? "\n" : null}
                    <OneCodeTokens tokens={tokens} />
                  </Fragment>
                ))}
          </Text>
        </ScrollView>
      </View>
    </View>
  );
});

/** The copy button is 28 points square, with a larger touch area. */
const COPY_SIZE = 28;

const styles = StyleSheet.create((theme) => ({
  // `.markdown-body pre > code`: rounded-xl, a border, and `bg-muted/30`.
  block: {
    borderRadius: theme.radius.xl,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.colors.insetFill,
    overflow: "hidden",
  },
  body: { flexDirection: "row" },
  scroll: { flexGrow: 1 },
  // Plain code has the 0.875rem padding of the desktop chat block. Highlighted code has the
  // 0.75rem by 0.875rem padding of the desktop syntax block.
  scrollContent: { paddingHorizontal: 14 },
  syntaxContent: { paddingVertical: 12 },
  plainContent: { paddingVertical: 14 },
  // The copy header sits above the code.
  belowHeader: { paddingTop: 2 },
  // The desktop code is IBM Plex Mono at medium weight, as `prose-code:font-medium` sets it. The
  // phone sizes are one step above the desktop sizes.
  // Plain: the `prose` pre at 0.875em with a 1.71 line height, and `text-[11px]` in `compact`.
  // Highlighted: the 12px and 1.45 line height of the desktop syntax block.
  code: { fontFamily: theme.fonts.mono.medium, fontWeight: "500" },
  plainCode: { fontSize: 13, lineHeight: 22, color: theme.desktop.foreground },
  plainCompactCode: { fontSize: 12, lineHeight: 20, color: theme.desktop.foreground },
  syntaxCode: { fontSize: 13, lineHeight: 19, color: ONE_THEME_COLORS[theme.scheme].base },
  syntaxCompactCode: { fontSize: 12, lineHeight: 18, color: ONE_THEME_COLORS[theme.scheme].base },
  gutter: {
    paddingLeft: 14,
    color: theme.desktop.mutedForeground,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
  syntaxGutter: { paddingTop: 12 },
  plainGutter: { paddingTop: 14 },
  header: {
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: 14,
    paddingRight: 4,
  },
  language: {
    ...theme.type.caption2,
    fontFamily: theme.fonts.mono.medium,
    color: theme.desktop.mutedForeground,
  },
  copy: {
    width: COPY_SIZE,
    height: COPY_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
}));
