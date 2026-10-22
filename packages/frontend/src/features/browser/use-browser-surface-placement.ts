import { useEffect, useState, useSyncExternalStore } from "react";
import type { BrowserSlot, BrowserSurfaceRegistry } from "./browser-surface-registry";

export type BrowserSurfacePlacement = {
  /** False while no shown panel holds the surface. */
  visible: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Size of a surface that no panel showed yet, so a page still has a normal viewport. */
const DEFAULT_SIZE = { width: 1280, height: 800 };

/**
 * Follows the panel slot of a surface. While the slot shows, it reads the slot box once per
 * animation frame, because panels move with transforms and splitters that no observer reports.
 * A hidden surface keeps its last box, so its page keeps its size.
 */
export const useBrowserSurfacePlacement = (
  slots: BrowserSurfaceRegistry<BrowserSlot>,
  key: string,
): BrowserSurfacePlacement => {
  useSyncExternalStore(slots.subscribe, slots.version);
  const slot = slots.get(key);
  const [placement, setPlacement] = useState<BrowserSurfacePlacement>({
    visible: false,
    left: 0,
    top: 0,
    ...DEFAULT_SIZE,
  });

  useEffect(() => {
    if (!slot?.visible) {
      setPlacement((current) => (current.visible ? { ...current, visible: false } : current));
      return;
    }
    let frame = 0;
    const measure = (): void => {
      const box = slot.element.getBoundingClientRect();
      // A slot with no box, such as inside a hidden ancestor, keeps the last page size.
      if (box.width <= 0 || box.height <= 0) {
        setPlacement((current) => (current.visible ? { ...current, visible: false } : current));
      } else {
        const next: BrowserSurfacePlacement = {
          visible: true,
          left: box.left,
          top: box.top,
          width: Math.round(box.width),
          height: Math.round(box.height),
        };
        setPlacement((current) => (samePlacement(current, next) ? current : next));
      }
      frame = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(frame);
  }, [slot]);

  return placement;
};

const samePlacement = (a: BrowserSurfacePlacement, b: BrowserSurfacePlacement): boolean =>
  a.visible === b.visible &&
  a.left === b.left &&
  a.top === b.top &&
  a.width === b.width &&
  a.height === b.height;
