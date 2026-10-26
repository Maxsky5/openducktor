import type { ReactElement } from "react";
import { View } from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { DELAYED_FADE_IN, SKELETON_PULSE } from "@/theme/tokens";
import { LoaderSpinner } from "@/ui/loader-spinner";
import { Text } from "@/ui/text";

/** The widths of the placeholder turns: a user message, tool rows, and lines of an answer. */
const TURNS = [
  { bubble: "58%", tools: ["46%"], answer: ["94%", "86%", "62%"] },
  { bubble: "40%", tools: ["38%", "52%"], answer: ["90%", "74%"] },
] as const;

/**
 * Placeholder messages with the layout of a transcript, for the first load of a session. They sit
 * above the composer, where the latest messages appear, under a small status pill that names what
 * loads, such as "Loading session". The pill fades in after a short delay, so a fast load shows
 * no text.
 */
export function TranscriptSkeleton({ label }: { label: string }): ReactElement {
  const theme = useAppTheme();
  const reducedMotion = useReducedMotion();
  return (
    <View style={styles.root} accessible accessibilityRole="progressbar" accessibilityLabel={label}>
      <Animated.View style={[styles.status, DELAYED_FADE_IN]}>
        <LoaderSpinner size={12} color={theme.desktop.mutedForeground} />
        <Text variant="caption1" weight="medium" numberOfLines={1} style={styles.statusText}>
          {label}
        </Text>
      </Animated.View>
      <Animated.View style={[styles.turns, reducedMotion ? null : SKELETON_PULSE]}>
        {TURNS.map((turn) => (
          <View key={turn.bubble} style={styles.turn}>
            <View style={[styles.bubble, { width: turn.bubble }]} />
            {turn.tools.map((width) => (
              <View key={width} style={styles.toolRow}>
                <View style={styles.toolIcon} />
                <View style={[styles.line, styles.toolLine, { width }]} />
              </View>
            ))}
            <View style={styles.answer}>
              {turn.answer.map((width) => (
                <View key={width} style={[styles.line, { width }]} />
              ))}
            </View>
          </View>
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    width: "100%",
    maxWidth: theme.layout.readableWidth + 2 * theme.layout.screenPadding,
    alignSelf: "center",
    justifyContent: "flex-end",
    paddingHorizontal: theme.layout.screenPadding,
    paddingBottom: theme.space.lg,
  },
  turns: { gap: theme.space.xxl },
  turn: { gap: theme.space.md },
  // The desktop user bubble shape, `rounded-xl rounded-br-sm`, in the placeholder color.
  bubble: {
    alignSelf: "flex-end",
    height: 40,
    borderRadius: theme.radius.xl,
    borderBottomRightRadius: theme.radius.sm,
    borderCurve: "continuous",
    backgroundColor: theme.desktop.secondary,
  },
  toolRow: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  toolIcon: { width: 14, height: 14, borderRadius: 4, backgroundColor: theme.desktop.secondary },
  toolLine: { height: 10 },
  answer: { gap: 10 },
  // The desktop `Skeleton` is `rounded-md bg-accent`. On the chat background, which is the
  // accent color in light mode, the placeholders use the secondary color so they show.
  line: { height: 12, borderRadius: theme.radius.md, backgroundColor: theme.desktop.secondary },
  // The status pill, as the desktop loading notice: a card with a turning loader.
  status: {
    alignSelf: "center",
    marginBottom: theme.space.xl,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 28,
    paddingHorizontal: theme.space.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
    boxShadow: theme.shadows.raised,
  },
  statusText: { color: theme.desktop.mutedForeground },
}));
