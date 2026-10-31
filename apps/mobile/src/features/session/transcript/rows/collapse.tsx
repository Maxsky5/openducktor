import {
  type PropsWithChildren,
  type ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  type LayoutChangeEvent,
  type StyleProp,
  useWindowDimensions,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import Animated, { type CSSStyle, useReducedMotion } from "react-native-reanimated";
import { motion } from "@/theme/tokens";
import { useListShown, useRowLayout } from "./disclosure";
import { HeightMotion } from "./height-motion";

const FADE_IN: CSSStyle<ViewStyle> = {
  animationName: { from: { opacity: 0 } },
  animationDuration: motion.fast,
  animationTimingFunction: motion.easeOut,
};

/**
 * Content that a press opens or closes. After a press, its height grows or shrinks with a
 * `HeightMotion`. Content that opens fades in. Each frame sets the height and asks the list to measure
 * the row again, so the rows under it move in the same frame: the list places rows from
 * JavaScript, so a native height animation moves them one frame late. Without a press, or with
 * reduced motion, the content shows or hides at once. With `from`, the content opens from that
 * height when it mounts, as the full text of a call after its loader. `gap` is the gap of the
 * parent before this part, so the gap opens with the content. Give it the key of its part: the
 * list reuses the view of a row for other rows.
 */
/**
 * The height and the shown state of a `Collapse`. Its first layout and each later layout of the
 * content go to `onContentLayout`.
 */
const useCollapseMotion = (open: boolean, animate: boolean, from: number | undefined) => {
  const layoutRow = useRowLayout();
  const listShown = useListShown();
  const reducedMotion = useReducedMotion();
  // A list off screen applies each change at once, as with reduced motion.
  const animates = animate && listShown && !reducedMotion;
  const appears = open && from !== undefined && listShown && !reducedMotion;
  const [heightMotion] = useState(() => new HeightMotion(appears ? from : undefined));
  /** The height while the content opens or closes, or null for the height of the content. */
  const [height, setHeight] = useState<number | null>(appears ? from : null);
  /** True while closed content still shows, as its height closes. */
  const [closing, setClosing] = useState(false);
  // A press already measured the row again, so the change shows in this render.
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    setClosing(!open && animates);
    if (!animates) setHeight(null);
    else if (open && !closing) setHeight(0);
  }

  const { height: windowHeight } = useWindowDimensions();
  useLayoutEffect(() => {
    heightMotion.connect({
      resize: (next) => {
        layoutRow?.();
        setHeight(next);
      },
      hide: () => {
        layoutRow?.();
        setClosing(false);
        setHeight(null);
      },
      limit: () => windowHeight,
    });
  }, [heightMotion, layoutRow, windowHeight]);
  useEffect(() => () => heightMotion.stop(), [heightMotion]);
  const startedFor = useRef(open);
  useLayoutEffect(() => {
    if (open === startedFor.current) return;
    startedFor.current = open;
    heightMotion.change(open, animates);
  }, [animates, heightMotion, open]);
  const onContentLayout = useCallback(
    (event: LayoutChangeEvent) => heightMotion.measure(event.nativeEvent.layout.height),
    [heightMotion],
  );

  return { shown: open || closing, height, onContentLayout };
};

export function Collapse({
  open,
  animate,
  from,
  gap = 0,
  style,
  children,
}: PropsWithChildren<{
  open: boolean;
  animate: boolean;
  from?: number | undefined;
  gap?: number | undefined;
  style?: StyleProp<ViewStyle>;
}>): ReactElement | null {
  const { shown, height, onContentLayout } = useCollapseMotion(open, animate, from);
  if (!shown) return null;
  const animated = height !== null;
  return (
    <View
      style={[
        gap > 0 ? { marginTop: -gap } : null,
        height === null ? null : { height, overflow: "hidden" },
      ]}
    >
      {/* While the height moves, the content lays out free of it, so text measures its full
          height. */}
      <Animated.View
        onLayout={onContentLayout}
        style={[
          style,
          gap > 0 ? { paddingTop: gap } : null,
          animated ? styles.free : null,
          animated && open ? FADE_IN : null,
        ]}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  free: { position: "absolute", top: 0, left: 0, right: 0 },
});
