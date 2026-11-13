import { useRecyclingState } from "@shopify/flash-list";
import {
  type PropsWithChildren,
  type ReactElement,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
} from "react";
import { type LayoutChangeEvent, type StyleProp, View, type ViewStyle } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import {
  FOLD_MOTION_MS,
  foldMotion,
  useCellIndex,
  useFoldMotionList,
} from "../transcript-fold-motion";
import { useLayoutRow } from "./disclosure";

/**
 * How the content shows: in the row, measuring itself before it opens, over the row while the
 * rows under it cover it as the row folds, or not at all.
 */
type FoldMode = "open" | "measuring" | "folding" | "folded";

/**
 * Content of a transcript row that opens and folds. When `open` changes after the content showed,
 * the row takes its new height at once, and the cells that the list moved glide from their old
 * place to their new one (see `transcript-fold-motion.ts`). Content that opens measures itself
 * first, out of the layout, so the motion knows its height. Content that folds stays over the row
 * until the rows under it have covered it. With reduced motion, outside a transcript list, and
 * when the row shows another part (`resetKey`), the content opens or folds at once.
 */
export function FoldReveal({
  open,
  resetKey,
  style,
  children,
}: PropsWithChildren<{
  open: boolean;
  resetKey: string;
  style?: StyleProp<ViewStyle>;
}>): ReactElement | null {
  const reducedMotion = useReducedMotion();
  const list = useFoldMotionList();
  const cellIndex = useCellIndex();
  const layoutRow = useLayoutRow();
  const [mode, setMode] = useRecyclingState<FoldMode>(open ? "open" : "folded", [resetKey]);
  const [shownOpen, setShownOpen] = useRecyclingState(open, [resetKey]);
  const contentHeight = useRef(0);
  const foldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animates = !reducedMotion && list !== null && cellIndex !== null;

  const clearFoldTimer = useCallback(() => {
    if (foldTimer.current) clearTimeout(foldTimer.current);
    foldTimer.current = null;
  }, []);

  /**
   * Resizes the row by `delta` points in the commit that renders the change: the list moves the
   * other rows and corrects its scroll in that commit, and the moved cells start where they were.
   */
  const resize = useCallback(
    (delta: number) => {
      if (!list || cellIndex === null) return;
      const index = cellIndex.current;
      list.motions.start(
        foldMotion({
          id: list.motions.nextId(),
          pivot: index,
          inverted: list.inverted,
          latestRowInView: list.firstVisibleIndex() === 0,
          delta,
        }),
        FOLD_MOTION_MS + 200,
      );
      list.resizeRow(index, delta);
    },
    [cellIndex, list],
  );

  // A change of `open` after the content showed opens or folds it with the motion.
  const onOpenChange = useEffectEvent((nextOpen: boolean) => {
    if (nextOpen === shownOpen) return;
    setShownOpen(nextOpen);
    clearFoldTimer();
    if (!animates) {
      setMode(nextOpen ? "open" : "folded");
      layoutRow?.();
      return;
    }
    if (nextOpen) {
      // The content measures itself out of the layout, then the row opens.
      setMode("measuring");
      return;
    }
    if (mode !== "open" || contentHeight.current === 0) {
      setMode("folded");
      return;
    }
    // The list measures its rows at the end of this commit. The fold starts after that, so the
    // measure does not replace the new height that the fold gives the list.
    const height = contentHeight.current;
    queueMicrotask(() => {
      setMode("folding");
      resize(-height);
      foldTimer.current = setTimeout(() => {
        foldTimer.current = null;
        setMode("folded");
      }, FOLD_MOTION_MS);
    });
  });
  useLayoutEffect(() => {
    onOpenChange(open);
  }, [open]);

  useEffect(() => clearFoldTimer, [clearFoldTimer, resetKey]);

  const onContentLayout = useCallback(
    (event: LayoutChangeEvent) => {
      contentHeight.current = event.nativeEvent.layout.height;
      if (mode !== "measuring" || contentHeight.current === 0) return;
      setMode("open");
      resize(contentHeight.current);
    },
    [mode, resize, setMode],
  );

  if (mode === "folded") return null;
  // While it measures itself or folds, the content lies over the row from where it starts, so it
  // takes no height of the row. Each mode keeps the same views, so the content does not mount
  // again in the commit that starts the motion.
  const over = mode !== "open";
  return (
    <View style={over ? styles.anchor : null}>
      <View
        collapsable={false}
        style={[over ? styles.over : null, mode === "measuring" ? styles.hidden : null, style]}
        pointerEvents={over ? "none" : "auto"}
        onLayout={onContentLayout}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: { height: 0 },
  over: { position: "absolute", top: 0, left: 0, right: 0 },
  hidden: { opacity: 0 },
});
