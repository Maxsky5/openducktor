import { type ReactElement, useCallback, useEffect, useId, useMemo, useState } from "react";
import { type AccessibilityActionEvent, type LayoutChangeEvent, View } from "react-native";
import {
  GestureDetector,
  useCompetingGestures,
  usePanGesture,
  useTapGesture,
} from "react-native-gesture-handler";
import Animated, {
  Easing,
  Keyframe,
  ReduceMotion,
  type SharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import { StyleSheet } from "react-native-unistyles";
import { scheduleOnRN } from "react-native-worklets";
import { useAppTheme } from "@/theme/app-theme-context";
import { haptics } from "../haptics";
import { Icon, type IconName } from "../icon";
import { Text } from "../text";
import {
  BUMP_HEIGHT,
  centerFor,
  EDGE_PAD,
  labelCenter,
  nearestEnabled,
  plateauFor,
  shellPath,
  THUMB_HEIGHT,
  TRACK_HEIGHT,
  thumbBounds,
  tickHeight,
  valueAt,
} from "./step-track-geometry";

export type StepTrackStop = { value: string; label: string; disabled?: boolean | undefined };

/** The fill of the track up to the thumb, and the tick color of its stop beside the thumb. */
export type StepTrackFill = { from: string; to: string; tick: string };

/** An icon in the thumb for each stop, which pops when the stop changes. */
export type StepTrackMarks = { icons: readonly IconName[]; colors: readonly string[] };

/** The look of the AICSS Reasoning Effort track, in each theme. */
const LOOK = {
  light: {
    shell: ["#e6e6e8", 0.504, "#e8e8e9", 0.357],
    line: ["#000000", 0.084],
    label: "#1d1d1d",
    labelDim: "rgba(29, 29, 29, 0.4)",
    tick: "rgba(0, 0, 0, 0.176)",
    thumbShadow: "0 1px 1px rgba(0, 0, 0, 0.1)",
  },
  dark: {
    shell: ["#ffffff", 0.07, "#ffffff", 0.1],
    line: ["#ffffff", 0.08],
    label: "#ffffff",
    labelDim: "rgba(255, 255, 255, 0.4)",
    tick: "rgba(255, 255, 255, 0.256)",
    thumbShadow: "0 1px 1px rgba(0, 0, 0, 0.18)",
  },
} as const;
const TICK_ON_THUMB = "rgba(0, 0, 0, 0.45)";

const EASE_OUT = Easing.out(Easing.cubic);
/** The label grows out of the track and folds back in this time. */
const OPEN = { duration: 220, easing: EASE_OUT };
/** The label text shows after the shoulder starts to grow, and hides before it folds. */
const REVEAL_DELAY = 85;
const REVEAL_IN = { duration: 132, easing: EASE_OUT };
const REVEAL_OUT = { duration: 90, easing: EASE_OUT };
const PLATEAU = { duration: 90, easing: EASE_OUT };
/** After a tap, the label stays open this long, so the user can read the new level. */
const TAP_HOLD = 650;
const NO_MOTION = { duration: 0 };

/** The label text changes with a short fade from a dim state. */
const LABEL_SWAP = new Keyframe({
  0: { opacity: 0.35 },
  100: { opacity: 1, easing: Easing.out(Easing.quad) },
})
  .duration(180)
  .reduceMotion(ReduceMotion.System);

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedRect = Animated.createAnimatedComponent(Rect);

/**
 * A stepped track, as the AICSS Reasoning Effort control. A tap moves the thumb to a stop. While
 * the user drags the thumb, the caption and the level grow out of the top edge of the track, then
 * fold back into it on release. Each new stop under the finger ticks a haptic.
 */
export function StepTrack({
  stops,
  value,
  caption,
  fills,
  marks,
  disabled = false,
  accessibilityLabel,
  onChange,
}: {
  stops: readonly StepTrackStop[];
  value: string;
  /** The text before the level in the label, such as the model name. */
  caption: string;
  /** One fill for every stop, or one fill for each stop that blends while the thumb moves. */
  fills: readonly StepTrackFill[];
  marks?: StepTrackMarks | undefined;
  disabled?: boolean | undefined;
  accessibilityLabel: string;
  /** A promise holds the thumb on the new stop until the change settles. */
  onChange: (value: string) => Promise<void> | void;
}): ReactElement {
  const theme = useAppTheme();
  const look = theme.scheme === "dark" ? LOOK.dark : LOOK.light;
  const reducedMotion = useReducedMotion();
  const count = stops.length;
  const selected = Math.max(
    0,
    stops.findIndex((stop) => stop.value === value),
  );
  const [requested, setRequested] = useState<number | null>(null);
  const rest = requested ?? selected;
  const [track, setTrack] = useState(0);
  const [live, setLive] = useState(rest);
  const disabledStops = useMemo(() => stops.map((stop) => stop.disabled === true), [stops]);

  const display = useSharedValue(rest);
  const open = useSharedValue(0);
  const reveal = useSharedValue(0);
  const plateau = useSharedValue(plateauFor(64));
  const textWidth = useSharedValue(64);
  const dragging = useSharedValue(false);
  const liveIndex = useSharedValue(rest);
  const burst = useSharedValue(0);
  const pop = useSharedValue(1);

  // A change from outside, or a settled change, moves the thumb to its stop.
  useEffect(() => {
    if (dragging.get()) return;
    display.set(withTiming(rest, reducedMotion ? NO_MOTION : OPEN));
    liveIndex.set(rest);
    setLive(rest);
  }, [display, dragging, liveIndex, reducedMotion, rest]);

  const commit = useCallback(
    (index: number) => {
      const stop = stops[index];
      if (!stop || index === selected) {
        setRequested(null);
        return;
      }
      setRequested(index);
      void Promise.resolve(onChange(stop.value)).finally(() => setRequested(null));
    },
    [onChange, selected, stops],
  );
  const reach = useCallback((index: number) => {
    setLive(index);
    haptics.selection();
  }, []);

  /** Moves the label stop to `index`. A faster stop plays the burst of the thumb icon. */
  const arrive = (index: number) => {
    "worklet";
    const previous = liveIndex.get();
    if (index === previous) return;
    liveIndex.set(index);
    if (!reducedMotion) {
      pop.set(
        withSequence(
          withTiming(index > previous ? 1.28 : 0.82, { duration: 90 }),
          withSpring(1, { duration: 320, dampingRatio: 0.55 }),
        ),
      );
      if (index > previous) {
        burst.set(0);
        burst.set(withTiming(1, { duration: 460, easing: EASE_OUT }));
      }
    }
    scheduleOnRN(reach, index);
  };
  const settle = (index: number) => {
    "worklet";
    display.set(withTiming(index, reducedMotion ? NO_MOTION : OPEN));
    arrive(index);
    scheduleOnRN(commit, index);
  };

  const interactive = !disabled && count > 1 && track > 0;
  const pan = usePanGesture({
    enabled: interactive,
    activeOffsetX: [-4, 4],
    failOffsetY: [-12, 12],
    onActivate: (event) => {
      dragging.set(true);
      open.set(withTiming(1, reducedMotion ? NO_MOTION : OPEN));
      reveal.set(reducedMotion ? 1 : withDelay(REVEAL_DELAY, withTiming(1, REVEAL_IN)));
      const next = valueAt(event.x, count, track);
      display.set(next);
      arrive(Math.round(next));
    },
    onUpdate: (event) => {
      const next = valueAt(event.x, count, track);
      display.set(next);
      arrive(Math.round(next));
    },
    onFinalize: () => {
      if (!dragging.get()) return;
      dragging.set(false);
      open.set(withTiming(0, reducedMotion ? NO_MOTION : OPEN));
      reveal.set(withTiming(0, reducedMotion ? NO_MOTION : REVEAL_OUT));
      const target = nearestEnabled(Math.round(display.get()), disabledStops);
      if (target !== null) settle(target);
    },
  });
  const tap = useTapGesture({
    enabled: interactive,
    maxDistance: 10,
    onActivate: (event) => {
      const target = nearestEnabled(Math.round(valueAt(event.x, count, track)), disabledStops);
      if (target === null) return;
      if (!reducedMotion) {
        open.set(withSequence(withTiming(1, OPEN), withDelay(TAP_HOLD, withTiming(0, OPEN))));
        reveal.set(
          withSequence(
            withDelay(REVEAL_DELAY, withTiming(1, REVEAL_IN)),
            withDelay(TAP_HOLD, withTiming(0, REVEAL_OUT)),
          ),
        );
      }
      settle(target);
    },
  });
  const gesture = useCompetingGestures(pan, tap);

  const stepBy = (event: AccessibilityActionEvent) => {
    const direction = event.nativeEvent.actionName === "increment" ? 1 : -1;
    for (let index = rest + direction; index >= 0 && index < count; index += direction) {
      if (!disabledStops[index]) {
        commit(index);
        return;
      }
    }
  };

  const onLayout = (event: LayoutChangeEvent) => setTrack(event.nativeEvent.layout.width);
  const onLabelLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    if (Math.abs(width - textWidth.get()) < 0.4) return;
    textWidth.set(width);
    plateau.set(withTiming(plateauFor(width), reducedMotion ? NO_MOTION : PLATEAU));
  };

  const thumbStyle = useAnimatedStyle(() => {
    const bounds = thumbBounds(centerFor(display.get(), count, track), open.get(), track);
    return { width: bounds.right - bounds.left, transform: [{ translateX: bounds.left }] };
  });
  const markStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.get() }] }));

  const stop = stops[live];
  const level = stop?.label ?? "";
  const ready = track > 0 && count > 1;
  return (
    <View
      style={[styles.root, disabled ? styles.disabled : null]}
      onLayout={onLayout}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: count - 1, now: rest, text: stops[rest]?.label }}
      accessibilityState={{ disabled }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={disabled ? undefined : stepBy}
    >
      {ready ? (
        <GestureDetector gesture={gesture}>
          <View style={styles.surface}>
            <TrackShell
              look={look}
              fills={fills}
              display={display}
              open={open}
              plateau={plateau}
              count={count}
              track={track}
            />
            {marks ? (
              <SpeedStreaks
                display={display}
                open={open}
                burst={burst}
                count={count}
                track={track}
              />
            ) : null}
            <Animated.View style={[styles.thumb, { boxShadow: look.thumbShadow }, thumbStyle]}>
              {marks ? (
                <Animated.View style={markStyle}>
                  <Icon
                    name={marks.icons[live] ?? marks.icons[0] ?? "zap"}
                    size={14}
                    colorValue={marks.colors[live]}
                  />
                </Animated.View>
              ) : null}
            </Animated.View>
            {stops.map((entry, index) => (
              <Tick
                key={entry.value}
                index={index}
                count={count}
                track={track}
                display={display}
                open={open}
                color={look.tick}
                activeColor={(fills[index] ?? fills[0])?.tick ?? look.tick}
                hideOnThumb={marks !== undefined}
              />
            ))}
            <TrackLabel
              caption={caption}
              level={level}
              look={look}
              display={display}
              open={open}
              plateau={plateau}
              reveal={reveal}
              textWidth={textWidth}
              count={count}
              track={track}
              onLayout={onLabelLayout}
            />
          </View>
        </GestureDetector>
      ) : null}
    </View>
  );
}

type TrackLook = (typeof LOOK)[keyof typeof LOOK];

/** The track shell, which grows a bump over the thumb, and the fills up to the thumb. */
function TrackShell({
  look,
  fills,
  display,
  open,
  plateau,
  count,
  track,
}: {
  look: TrackLook;
  fills: readonly StepTrackFill[];
  display: SharedValue<number>;
  open: SharedValue<number>;
  plateau: SharedValue<number>;
  count: number;
  track: number;
}): ReactElement {
  const gradientId = useId().replace(/:/g, "");
  const shellProps = useAnimatedProps(() => ({
    d: shellPath(centerFor(display.get(), count, track), open.get(), plateau.get(), track),
  }));
  return (
    <Svg width={track} height={BUMP_HEIGHT + TRACK_HEIGHT} style={styles.svg}>
      <Defs>
        <LinearGradient id={`${gradientId}-shell`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={look.shell[0]} stopOpacity={look.shell[1]} />
          <Stop offset="1" stopColor={look.shell[2]} stopOpacity={look.shell[3]} />
        </LinearGradient>
        {fills.map((fill, index) => (
          <LinearGradient
            // The fills are a fixed list, and fill N blends in at stop N.
            // react-doctor-disable-next-line react-doctor/no-array-index-as-key
            key={`${fill.from}-${fill.to}-${index}`}
            id={`${gradientId}-fill-${index}`}
            x1="0"
            y1="0"
            x2="1"
            y2="0"
          >
            <Stop offset="0" stopColor={fill.from} />
            <Stop offset="1" stopColor={fill.to} />
          </LinearGradient>
        ))}
      </Defs>
      <AnimatedPath
        animatedProps={shellProps}
        fill={`url(#${gradientId}-shell)`}
        stroke={look.line[0]}
        strokeOpacity={look.line[1]}
        strokeWidth={0.5}
        strokeLinejoin="round"
      />
      {fills.map((fill, index) => (
        <TrackFill
          // The fills are a fixed list, and fill N blends in at stop N.
          // react-doctor-disable-next-line react-doctor/no-array-index-as-key
          key={`${fill.from}-${fill.to}-${index}`}
          index={index}
          blend={fills.length > 1}
          gradient={`url(#${gradientId}-fill-${index})`}
          display={display}
          open={open}
          count={count}
          track={track}
        />
      ))}
    </Svg>
  );
}

/** The caption and the level, which grow out of the top edge of the track while it is open. */
function TrackLabel({
  caption,
  level,
  look,
  display,
  open,
  plateau,
  reveal,
  textWidth,
  count,
  track,
  onLayout,
}: {
  caption: string;
  level: string;
  look: TrackLook;
  display: SharedValue<number>;
  open: SharedValue<number>;
  plateau: SharedValue<number>;
  reveal: SharedValue<number>;
  textWidth: SharedValue<number>;
  count: number;
  track: number;
  onLayout: (event: LayoutChangeEvent) => void;
}): ReactElement {
  const labelStyle = useAnimatedStyle(() => {
    const center = labelCenter(centerFor(display.get(), count, track), plateau.get(), track);
    return {
      opacity: reveal.get(),
      transform: [
        { translateX: center - textWidth.get() / 2 },
        { translateY: 3 * (1 - open.get()) },
      ],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      onLayout={onLayout}
      style={[styles.label, { maxWidth: Math.max(60, track - 96) }, labelStyle]}
    >
      <Animated.View key={level} entering={LABEL_SWAP} style={styles.swap}>
        <Text
          variant="caption2"
          numberOfLines={1}
          style={[styles.labelText, styles.caption, { color: look.label }]}
        >
          {caption}
        </Text>
        <Text
          variant="caption2"
          numberOfLines={1}
          style={[styles.labelText, { color: look.labelDim }]}
        >
          {level}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

/** The fill up to the thumb. Several fills blend by their distance to the thumb. */
function TrackFill({
  index,
  blend,
  gradient,
  display,
  open,
  count,
  track,
}: {
  index: number;
  blend: boolean;
  gradient: string;
  display: SharedValue<number>;
  open: SharedValue<number>;
  count: number;
  track: number;
}): ReactElement {
  const props = useAnimatedProps(() => {
    const position = display.get();
    const bounds = thumbBounds(centerFor(position, count, track), open.get(), track);
    return {
      width: Math.min(track, bounds.right + EDGE_PAD),
      opacity: blend ? Math.max(0, 1 - Math.abs(position - index)) : 1,
    };
  });
  return (
    <AnimatedRect
      animatedProps={props}
      x={0}
      y={BUMP_HEIGHT}
      height={TRACK_HEIGHT}
      rx={TRACK_HEIGHT / 2}
      fill={gradient}
    />
  );
}

/**
 * The tick of a stop. It darkens under the thumb, and takes the fill tick color while it is the
 * nearest stop beside the thumb.
 */
function Tick({
  index,
  count,
  track,
  display,
  open,
  color,
  activeColor,
  hideOnThumb,
}: {
  index: number;
  count: number;
  track: number;
  display: SharedValue<number>;
  open: SharedValue<number>;
  color: string;
  activeColor: string;
  /** True when the thumb shows an icon, so a tick does not cross it. */
  hideOnThumb: boolean;
}): ReactElement {
  const x = centerFor(index, count, track);
  const height = tickHeight(index, count);
  const style = useAnimatedStyle(() => {
    const position = display.get();
    const bounds = thumbBounds(centerFor(position, count, track), open.get(), track);
    const onThumb = x >= bounds.left + 0.5 && x <= bounds.right - 0.5;
    const active = Math.round(position) === index && !onThumb;
    return {
      opacity: onThumb && hideOnThumb ? 0 : 1,
      backgroundColor: onThumb ? TICK_ON_THUMB : active ? activeColor : color,
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.tick,
        { left: x - 0.75, height, top: BUMP_HEIGHT + (TRACK_HEIGHT - height) / 2 },
        style,
      ]}
    />
  );
}

/** Three short lines that trail the thumb after it reaches a faster stop. */
const STREAKS = [
  { y: -6, width: 12, delay: 0.1 },
  { y: 0, width: 20, delay: 0 },
  { y: 6, width: 10, delay: 0.18 },
] as const;

function SpeedStreaks({
  display,
  open,
  burst,
  count,
  track,
}: {
  display: SharedValue<number>;
  open: SharedValue<number>;
  burst: SharedValue<number>;
  count: number;
  track: number;
}): ReactElement {
  return (
    <>
      {STREAKS.map((streak) => (
        <Streak
          key={streak.y}
          {...streak}
          display={display}
          open={open}
          burst={burst}
          count={count}
          track={track}
        />
      ))}
    </>
  );
}

function Streak({
  y,
  width,
  delay,
  display,
  open,
  burst,
  count,
  track,
}: {
  y: number;
  width: number;
  delay: number;
  display: SharedValue<number>;
  open: SharedValue<number>;
  burst: SharedValue<number>;
  count: number;
  track: number;
}): ReactElement {
  const style = useAnimatedStyle(() => {
    const value = burst.get();
    const t = Math.min(1, Math.max(0, (value - delay) / (1 - delay)));
    const bounds = thumbBounds(centerFor(display.get(), count, track), open.get(), track);
    return {
      opacity: value === 0 || value === 1 ? 0 : 0.85 * (1 - t),
      transform: [{ translateX: bounds.left - width - 4 - 34 * t }, { scaleX: 1 - 0.4 * t }],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.streak, { width, top: BUMP_HEIGHT + TRACK_HEIGHT / 2 + y - 1 }, style]}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { height: BUMP_HEIGHT + TRACK_HEIGHT, alignSelf: "stretch" },
  disabled: { opacity: 0.5 },
  surface: { flex: 1 },
  svg: { position: "absolute", top: 0, left: 0, overflow: "visible" },
  thumb: {
    position: "absolute",
    left: 0,
    top: BUMP_HEIGHT + (TRACK_HEIGHT - THUMB_HEIGHT) / 2,
    height: THUMB_HEIGHT,
    borderRadius: THUMB_HEIGHT / 2,
    backgroundImage: "linear-gradient(180deg, #ffffff, #f5f5f5)",
    alignItems: "center",
    justifyContent: "center",
  },
  tick: { position: "absolute", width: 1.5, borderRadius: 1 },
  streak: {
    position: "absolute",
    left: 0,
    height: 2,
    borderRadius: 1,
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    transformOrigin: "right",
  },
  label: { position: "absolute", left: 0, top: 2.5 },
  swap: { flexDirection: "row", gap: 3 },
  labelText: {
    fontFamily: theme.fonts.sans.medium,
    fontWeight: "500",
    fontSize: 10.5,
    lineHeight: 14,
    letterSpacing: -0.1,
  },
  caption: { flexShrink: 1 },
}));
