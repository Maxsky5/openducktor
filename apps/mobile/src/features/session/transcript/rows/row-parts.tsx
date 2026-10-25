import { formatAgentDuration } from "@openducktor/frontend-core/sessions/transcript/format-agent-duration";
import {
  memo,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
  useCallback,
} from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";
import Animated, { type CSSStyle, useReducedMotion } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useClipboardCopy } from "@/platform/use-clipboard-copy";
import { useAppTheme } from "@/theme/app-theme-context";
import { LoaderSpinner } from "@/ui/loader-spinner";
import { monoWeight, motion, sansWeight } from "@/theme/tokens";
import { Icon, type IconName } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { truncateForDisplay } from "../transcript-text";
import { type Disclosure, useDisclosure } from "./disclosure";

/** The marker of a desktop `<details>` summary: a small chevron that turns down when open. */
export function DisclosureMarker({
  open,
  animated,
  color,
  size = 11,
}: {
  open: boolean;
  animated: boolean;
  color: string;
  size?: number;
}): ReactElement {
  const reducedMotion = useReducedMotion();
  const turn: CSSStyle<ViewStyle> = {
    transform: [{ rotate: open ? "90deg" : "0deg" }],
    transitionProperty: "transform",
    transitionDuration: animated && !reducedMotion ? motion.fast : 0,
    transitionTimingFunction: motion.easeOut,
  };
  return (
    <Animated.View style={turn}>
      <Icon name="chevron-right" size={size} colorValue={color} />
    </Animated.View>
  );
}

const REVEAL: CSSStyle<ViewStyle> = {
  animationName: {
    from: { opacity: 0, transform: [{ translateY: -4 }] },
    to: { opacity: 1, transform: [{ translateY: 0 }] },
  },
  animationDuration: motion.base,
  animationTimingFunction: motion.easeOut,
};

const REVEAL_REDUCED: CSSStyle<ViewStyle> = {
  animationName: { from: { opacity: 0 }, to: { opacity: 1 } },
  animationDuration: motion.fast,
  animationTimingFunction: motion.easeOut,
};

/** Content that a press opened. It fades in only after a press, never when a row mounts. */
export function Reveal({
  animate,
  style,
  children,
}: PropsWithChildren<{ animate: boolean; style?: StyleProp<ViewStyle> }>): ReactElement {
  const reducedMotion = useReducedMotion();
  const motionStyle = animate ? (reducedMotion ? REVEAL_REDUCED : REVEAL) : null;
  return <Animated.View style={[style, motionStyle]}>{children}</Animated.View>;
}

/** Copies a text and says the result, as the desktop copy buttons. */
const useCopyText = (text: string, what: string): (() => void) => {
  const { copyText } = useClipboardCopy();
  return useCallback(() => {
    void copyText(text, {
      copied: `${what} copied.`,
      failed: `The ${what.toLowerCase()} was not copied.`,
    });
  }, [copyText, text, what]);
};

/** A small copy icon with a full touch area that does not grow the line around it. */
export const CopyControl = memo(function CopyControl({
  text,
  what,
  accessibilityLabel,
  color,
}: {
  text: string;
  /** The copied thing for the result message, such as "Output". */
  what: string;
  accessibilityLabel: string;
  color: string;
}): ReactElement {
  const copy = useCopyText(text, what);
  return (
    <Touchable
      feedback="opacity"
      onPress={copy}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={styles.copy}
    >
      <Icon name="copy" size={13} colorValue={color} />
    </Touchable>
  );
});

/**
 * The desktop `ToolMessageTiming`: a spinner while the call runs, the run time, and the clock
 * time, in 11-point muted text at the end of a line.
 */
export const ToolTiming = memo(function ToolTiming({
  active,
  durationMs,
  timeLabel,
  color,
}: {
  active: boolean;
  durationMs: number | null;
  timeLabel: string;
  color?: string | undefined;
}): ReactElement | null {
  const theme = useAppTheme();
  const tint = color ?? theme.desktop.mutedForeground;
  if (!active && durationMs === null && timeLabel.length === 0) return null;
  return (
    <View style={styles.timing}>
      {active ? <LoaderSpinner size={12} color={tint} /> : null}
      {durationMs !== null ? (
        <Text style={[styles.timingText, { color: tint }]}>{formatAgentDuration(durationMs)}</Text>
      ) : null}
      {timeLabel.length > 0 ? (
        <Text style={[styles.timingText, { color: tint }]}>{timeLabel}</Text>
      ) : null}
    </View>
  );
});

export type ToolLineTone = "plain" | "preparing" | "failed" | "cancelled";

/**
 * The desktop `RegularToolSummary`: a plain muted icon, the tool name as the runtime names it,
 * the summary in muted text, and the timing at the end. A failed or cancelled call draws its
 * name and icon in its status color, and a preparing call shows at half opacity in muted colors.
 * A line with details opens them with a press.
 */
export const ToolLine = memo(function ToolLine({
  icon,
  name,
  summary,
  summaryEllipsis = "tail",
  tone,
  active,
  durationMs,
  timeLabel,
  disclosure,
  accessibilityLabel,
}: {
  icon: IconName;
  name: string;
  summary: string;
  /** "middle" keeps both ends of a path in view. */
  summaryEllipsis?: "tail" | "middle" | undefined;
  tone: ToolLineTone;
  active: boolean;
  durationMs: number | null;
  timeLabel: string;
  disclosure?: Disclosure | null | undefined;
  accessibilityLabel: string;
}): ReactElement {
  const theme = useAppTheme();
  const { desktop } = theme;
  const nameColor =
    tone === "failed"
      ? desktop.destructiveMuted
      : tone === "cancelled"
        ? desktop.cancelledMuted
        : tone === "preparing"
          ? desktop.mutedForeground
          : desktop.foreground;
  const iconColor =
    tone === "failed"
      ? desktop.destructiveAccent
      : tone === "cancelled"
        ? desktop.cancelledAccent
        : desktop.mutedForeground;
  const content = (
    <>
      <Icon name={icon} size={14} colorValue={iconColor} />
      <Text numberOfLines={1} style={[styles.lineName, { color: nameColor }]}>
        {name}
      </Text>
      {summary.length > 0 ? (
        <Text
          numberOfLines={1}
          ellipsizeMode={summaryEllipsis}
          style={[styles.lineText, styles.lineSummary]}
        >
          {summary}
        </Text>
      ) : (
        <View style={styles.lineSpacer} />
      )}
      <ToolTiming active={active} durationMs={durationMs} timeLabel={timeLabel} />
    </>
  );
  if (!disclosure) {
    return (
      <View
        style={[styles.lineTouch, styles.line, tone === "preparing" && styles.linePreparing]}
        accessible
        accessibilityRole="text"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ busy: active }}
      >
        {content}
      </View>
    );
  }
  return (
    <Touchable
      feedback="highlight"
      radius={theme.radius.sm}
      onPress={disclosure.toggle}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={disclosure.open ? "Hides the details." : "Shows the details."}
      accessibilityState={{ expanded: disclosure.open, busy: active }}
      containerStyle={styles.lineTouch}
      style={[styles.line, tone === "preparing" && styles.linePreparing]}
    >
      {content}
    </Touchable>
  );
});

/**
 * A desktop `<details>` box with a summary row: `rounded border` with the label in 12-point
 * medium text, and its content under the summary only while open. `frameStyle` and `textColor`
 * set the colors of the box, such as the destructive colors of an error.
 */
export function DetailsBox({
  label,
  resetKey,
  defaultOpen = false,
  frameStyle,
  textColor,
  copyText,
  divided = false,
  children,
}: {
  label: string;
  /** The message or item that owns the box. */
  resetKey: string;
  defaultOpen?: boolean;
  frameStyle: StyleProp<ViewStyle>;
  textColor: string;
  /** Adds a copy control to the open summary. The box reads the text only while it is open. */
  copyText?: (() => string) | undefined;
  /** A hairline between the summary and the content, as the questions box. */
  divided?: boolean;
  children: ReactNode;
}): ReactElement {
  const disclosure = useDisclosure(defaultOpen, resetKey);
  return (
    <View style={[styles.box, frameStyle]}>
      <Touchable
        feedback="highlight"
        radius={4}
        onPress={disclosure.toggle}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: disclosure.open }}
        style={styles.boxSummary}
      >
        <DisclosureMarker open={disclosure.open} animated={disclosure.pressed} color={textColor} />
        <Text style={[styles.boxLabel, { color: textColor }]}>{label}</Text>
        {disclosure.open && copyText !== undefined ? (
          <CopyControl
            text={copyText()}
            what={label}
            accessibilityLabel={`Copy ${label.toLowerCase()}`}
            color={textColor}
          />
        ) : null}
      </Touchable>
      {disclosure.open ? (
        <Reveal animate={disclosure.pressed} style={[styles.boxBody, divided && styles.boxDivided]}>
          {children}
        </Reveal>
      ) : null}
    </View>
  );
}

/**
 * Tool text as the desktop `<pre className="whitespace-pre-wrap text-[11px]">`: monospace,
 * wrapped, and selectable, cut at a size that keeps scrolling smooth.
 */
export const PreText = memo(function PreText({
  text,
  color,
}: {
  text: string;
  color: string;
}): ReactElement {
  const shown = truncateForDisplay(text);
  return (
    <>
      <Text selectable style={[styles.pre, { color }]}>
        {shown.text}
      </Text>
      {shown.truncated ? <Text style={[styles.timingText, { color }]}>{shown.notice}</Text> : null}
    </>
  );
});

/** A desktop status pill: `rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase`. */
export const StatusPill = memo(function StatusPill({
  label,
  surface,
  border,
  text,
  weight = "semibold",
}: {
  label: string;
  surface: string;
  border: string;
  text: string;
  weight?: "medium" | "semibold";
}): ReactElement {
  return (
    <View style={[styles.pill, { backgroundColor: surface, borderColor: border }]}>
      <Text
        numberOfLines={1}
        style={[styles.pillText, weight === "medium" ? styles.pillMedium : null, { color: text }]}
      >
        {label}
      </Text>
    </View>
  );
});

/** The space before details under a tool line: the desktop `ml-5 mt-1 space-y-2`. */
export function LineDetails({
  animate,
  children,
}: PropsWithChildren<{ animate: boolean }>): ReactElement {
  return (
    <Reveal animate={animate} style={styles.lineDetails}>
      {children}
    </Reveal>
  );
}

/** The inset of tool details: the desktop `px-1` of the tool container and the `ml-5` of the details. */
export const LINE_DETAILS_INSET = 24;

const LINE_GAP = 8;

const styles = StyleSheet.create((theme) => ({
  copy: { marginVertical: -4, paddingHorizontal: 4 },
  timing: {
    flexDirection: "row",
    alignItems: "center",
    gap: LINE_GAP,
    flexShrink: 0,
    marginLeft: "auto",
  },
  timingText: {
    ...sansWeight("regular"),
    fontSize: 11.5,
    lineHeight: 16,
    fontVariant: ["tabular-nums"],
  },
  // The desktop tool container has `px-1`; the press highlight spans the whole row.
  lineTouch: {},
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: LINE_GAP,
    minHeight: 32,
    paddingHorizontal: theme.space.xs,
  },
  // The desktop `opacity-50` of a preparing call.
  linePreparing: { opacity: 0.5 },
  lineName: {
    ...sansWeight("medium"),
    fontSize: 13,
    lineHeight: 18,
    flexShrink: 0,
    maxWidth: "45%",
  },
  lineText: { ...sansWeight("regular"), fontSize: 13, lineHeight: 18, flexShrink: 0 },
  lineSummary: { flex: 1, flexShrink: 1, minWidth: 0, color: theme.desktop.mutedForeground },
  lineSpacer: { flex: 1 },
  box: { borderWidth: 1, borderRadius: 4, overflow: "hidden" },
  boxSummary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 32,
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.space.xs,
  },
  boxLabel: { ...sansWeight("medium"), fontSize: 13, lineHeight: 18, flex: 1 },
  boxBody: {
    paddingHorizontal: theme.space.sm,
    paddingBottom: theme.space.sm,
    gap: theme.space.sm,
  },
  boxDivided: {
    borderTopWidth: 1,
    borderTopColor: theme.desktop.border,
    paddingTop: theme.space.sm,
  },
  pre: { ...monoWeight("regular"), fontSize: 11.5, lineHeight: 17 },
  pill: {
    flexShrink: 0,
    borderWidth: 1,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  pillText: {
    ...sansWeight("semibold"),
    fontSize: 10.5,
    lineHeight: 14,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  pillMedium: sansWeight("medium"),
  lineDetails: {
    paddingLeft: LINE_DETAILS_INSET,
    paddingRight: theme.space.xs,
    paddingTop: theme.space.xs,
    paddingBottom: theme.space.xs,
    gap: theme.space.sm,
  },
}));
