import { type RefObject, useLayoutEffect, useState } from "react";

/** From this editor width, the outline, the canvas, and the inspector show side by side. */
const WIDE_EDITOR_MIN_WIDTH = 1100;

/**
 * Whether the editor is wide enough for three columns, or null before the first measure. The
 * value changes only when the width crosses `WIDE_EDITOR_MIN_WIDTH`.
 */
export const useWideEditor = (ref: RefObject<HTMLElement | null>): boolean | null => {
  const [wide, setWide] = useState<boolean | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    // The first measure comes before the first paint, so the editor never shows a wrong layout.
    setWide(element.clientWidth >= WIDE_EDITOR_MIN_WIDTH);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWide(entry.contentRect.width >= WIDE_EDITOR_MIN_WIDTH);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return wide;
};
