import { useIsFocused } from "expo-router";
import { memo, type ReactElement, useEffect, useMemo, useState } from "react";
import { type LayoutChangeEvent, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { type RayPath, rayPath, rayPointAt } from "./border-ray-path";

/** The desktop `BorderRay` defaults: `strokeWidth={2.6}` and `rayLengthRatio={0.12}`, one turn in 3 s. */
const STROKE_WIDTH = 2.6;
const TURN_MS = 3000;
/** The length of one segment of the ray. Short segments follow the rounded corners closely. */
const SEGMENT_LENGTH = 6;
const MAX_SEGMENTS = 32;

type Size = { width: number; height: number };

/**
 * The desktop `BorderRay`: a light that runs around a card while an agent works, such as the
 * composer card or a board card with a running session. The ray is a chain of short round
 * segments that follow the edge. Only their transforms change on each frame, on the UI thread,
 * so the ray draws no picture again. It runs only while its screen has focus. With reduced
 * motion, the ray stays still, as on desktop.
 */
export const BorderRay = memo(function BorderRay({
  color,
  radius,
  turnMs = TURN_MS,
  strokeWidth = STROKE_WIDTH,
}: {
  color: string;
  radius: number;
  turnMs?: number | undefined;
  strokeWidth?: number | undefined;
}): ReactElement | null {
  const focused = useIsFocused();
  const [size, setSize] = useState<Size | null>(null);
  const onLayout = (event: LayoutChangeEvent): void => {
    const { width, height } = event.nativeEvent.layout;
    setSize((current) =>
      current && Math.abs(current.width - width) < 0.5 && Math.abs(current.height - height) < 0.5
        ? current
        : { width, height },
    );
  };
  if (!focused) return null;
  return (
    <View
      style={styles.fill}
      pointerEvents="none"
      onLayout={onLayout}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {size ? (
        <RaySegments
          path={rayPath(size, radius)}
          color={color}
          turnMs={turnMs}
          strokeWidth={strokeWidth}
        />
      ) : null}
    </View>
  );
});

function RaySegments({
  path,
  color,
  turnMs,
  strokeWidth,
}: {
  path: RayPath;
  color: string;
  turnMs: number;
  strokeWidth: number;
}): ReactElement {
  const reducedMotion = useReducedMotion();
  const head = useSharedValue(0);
  useEffect(() => {
    head.set(0);
    if (reducedMotion) return;
    head.set(
      withRepeat(
        withTiming(path.perimeter, { duration: turnMs, easing: Easing.linear }),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(head);
  }, [head, path.perimeter, reducedMotion, turnMs]);
  const count = Math.min(MAX_SEGMENTS, Math.max(1, Math.ceil(path.rayLength / SEGMENT_LENGTH)));
  const step = path.rayLength / count;
  const segments = useMemo(() => Array.from({ length: count }, (_, index) => index), [count]);
  return (
    <>
      {segments.map((index) => (
        <RaySegment
          key={index}
          head={head}
          path={path}
          // Each segment covers its step and reaches half a stroke into its neighbors, so the
          // segments meet as one line.
          back={index * step + step / 2}
          length={step + strokeWidth}
          color={color}
          strokeWidth={strokeWidth}
        />
      ))}
    </>
  );
}

function RaySegment({
  head,
  path,
  back,
  length,
  color,
  strokeWidth,
}: {
  head: SharedValue<number>;
  path: RayPath;
  /** The distance from the head of the ray to the middle of this segment. */
  back: number;
  length: number;
  color: string;
  strokeWidth: number;
}): ReactElement {
  const motion = useAnimatedStyle(() => {
    const point = rayPointAt(path, head.get() - back);
    return {
      transform: [
        { translateX: point.x - length / 2 },
        { translateY: point.y - strokeWidth / 2 },
        { rotate: `${point.angle}rad` },
      ],
    };
  });
  return (
    <Animated.View
      style={[
        styles.segment,
        {
          width: length,
          height: strokeWidth,
          borderRadius: strokeWidth / 2,
          backgroundColor: color,
        },
        motion,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  fill: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  segment: { position: "absolute", top: 0, left: 0 },
});
