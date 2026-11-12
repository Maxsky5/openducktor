import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import type { ToolLifecyclePhase } from "@openducktor/frontend-core/sessions/messages/tool-lifecycle";
import { memo, type ReactElement } from "react";
import { type StyleProp, type TextStyle, View, type ViewStyle } from "react-native";
import Animated, { type CSSStyle, useReducedMotion } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { motion } from "@/theme/tokens";
import type { AppTheme } from "@/theme/tokens";
import { Icon } from "@/ui/icon";
import { LoaderSpinner } from "@/ui/loader-spinner";
import { Text } from "@/ui/text";
import { useEndlessAnimation } from "@/ui/use-endless-animation";
import { useValueAtMount } from "@/ui/use-value-at-mount";
import { toolIcon } from "./tool-icon";
import { TOOL_STATUS } from "./tool-status-presentation";

/** The desktop `agent-tool-running-pulse` keyframes of one bar. */
const barPulse = (delay: number): CSSStyle<ViewStyle> => ({
  animationName: {
    "0%": { opacity: 0.45, transform: [{ scaleY: 0.4 }] },
    "15%": { opacity: 1, transform: [{ scaleY: 1 }] },
    "45%": { opacity: 0.45, transform: [{ scaleY: 0.4 }] },
    "100%": { opacity: 0.45, transform: [{ scaleY: 0.4 }] },
  },
  animationDuration: 1200,
  animationDelay: delay,
  animationIterationCount: "infinite",
  animationTimingFunction: motion.easeOut,
});

const BARS = [
  { key: "first", pulse: barPulse(0) },
  { key: "second", pulse: barPulse(120) },
  { key: "third", pulse: barPulse(240) },
] as const;

/** One moving bar. With reduced motion, the bar stays still at three quarters of its height. */
function RunningBar({ pulse, color }: { pulse: CSSStyle<ViewStyle>; color: string }): ReactElement {
  const animation = useEndlessAnimation(pulse);
  return (
    <Animated.View style={[styles.bar, { backgroundColor: color }, animation ?? styles.barStill]} />
  );
}

/**
 * The desktop `ToolRunningBars`: three bars that pulse one after the other while a call runs.
 * They pause while a sheet or another screen covers their screen.
 */
export const ToolRunningBars = memo(function ToolRunningBars({
  color,
}: {
  color: string;
}): ReactElement {
  return (
    <View
      style={styles.bars}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {BARS.map(({ key, pulse }) => (
        <RunningBar key={key} pulse={pulse} color={color} />
      ))}
    </View>
  );
});

/** The desktop `ToolStatusIcon`: the icon of the phase of a tool call, with its label. */
export function ToolStatusIcon({
  phase,
  decorative = false,
  colorValue,
}: {
  phase: ToolLifecyclePhase;
  /** True next to the visible label, so screen readers skip the icon. */
  decorative?: boolean;
  /** Replaces the color of the phase, such as for a quiet success in a log. */
  colorValue?: string | undefined;
}): ReactElement {
  const { desktop } = useAppTheme();
  const status = TOOL_STATUS[phase];
  const color = colorValue ?? status.color(desktop);
  return (
    <View
      style={styles.icon}
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : "image"}
      accessibilityLabel={decorative ? undefined : status.label}
      importantForAccessibility={decorative ? "no-hide-descendants" : "auto"}
    >
      {status.icon === null ? (
        <ToolRunningBars color={color} />
      ) : (
        <Icon name={status.icon} size={14} colorValue={color} />
      )}
    </View>
  );
}

/** The label of the phase of a tool call, in the text color of the phase. */
export function ToolStatusLabel({
  phase,
  style,
}: {
  phase: ToolLifecyclePhase;
  style: StyleProp<TextStyle>;
}): ReactElement {
  const { desktop } = useAppTheme();
  const status = TOOL_STATUS[phase];
  return <Text style={[style, { color: status.textColor(desktop) }]}>{status.label}</Text>;
}

/**
 * The color of the icon of a call by status, as on desktop. A call that succeeded keeps the color
 * of the other tool icons, so only running, failed, and cancelled calls stand out.
 */
const callIconColor = (phase: ToolLifecyclePhase, desktop: AppTheme["desktop"]): string => {
  if (phase === "failed") return desktop.destructiveMuted;
  if (phase === "cancelled") return desktop.cancelledMuted;
  if (phase === "executing") return desktop.statusRunningForeground;
  return desktop.mutedForeground;
};

type ToolCallGlyph = "spinner" | "bars" | "tool";

const readToolCallGlyph = (phase: ToolLifecyclePhase): ToolCallGlyph => {
  if (phase === "executing") return "bars";
  if (phase === "preparing") return "spinner";
  return "tool";
};

/** The desktop `tool-call-icon-swap-in`: a new icon fades and grows in. */
const SWAP_IN: CSSStyle<ViewStyle> = {
  animationName: { from: { opacity: 0, transform: [{ scale: 0.6 }] } },
  animationDuration: 220,
  animationTimingFunction: motion.easeOut,
};

/**
 * The desktop `ToolCallIcon`: the icon of a call in its row, in the color of its status. A spinner
 * takes its place while the agent writes the call, and moving bars while the call runs. A new
 * icon fades and grows in. The box is as high as the first text line of the row, so the icon sits
 * on its middle. Screen readers read the status.
 */
export function ToolCallIcon({
  meta,
  phase,
}: {
  meta: Pick<ToolMeta, "tool" | "toolType">;
  phase: ToolLifecyclePhase;
}): ReactElement {
  const { desktop } = useAppTheme();
  const reducedMotion = useReducedMotion();
  const glyph = readToolCallGlyph(phase);
  // The row of a call mounts again for another call, so the icon that it mounted with shows still.
  const mountGlyph = useValueAtMount(glyph);
  const color = callIconColor(phase, desktop);
  return (
    <View
      style={styles.icon}
      accessible
      accessibilityRole="image"
      accessibilityLabel={TOOL_STATUS[phase].label}
    >
      <Animated.View
        key={glyph}
        style={[styles.glyph, glyph !== mountGlyph && !reducedMotion ? SWAP_IN : null]}
      >
        {glyph === "bars" ? <ToolRunningBars color={color} /> : null}
        {glyph === "spinner" ? <LoaderSpinner size={12} color={color} /> : null}
        {glyph === "tool" ? <Icon name={toolIcon(meta)} size={14} colorValue={color} /> : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // The first line of a call is 18 points high, so the icon sits on its middle.
  icon: { width: 14, height: 18, alignItems: "center", justifyContent: "center" },
  glyph: { alignItems: "center", justifyContent: "center" },
  // The desktop 12-point box of three 2-point bars, 2 points apart.
  bars: {
    width: 12,
    height: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  bar: { width: 2, height: 10, borderRadius: 1 },
  barStill: { opacity: 0.75, transform: [{ scaleY: 0.75 }] },
});
