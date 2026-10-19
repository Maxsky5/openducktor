import {
  animate,
  frame,
  type MotionValue,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
} from "motion/react";
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { MOTION_EASE_OUT_POINTS } from "@/components/ui/motion";
import { MINIMAP_WAVE_RISE_SECONDS, MINIMAP_WAVE_FALL_SECONDS } from "./constants";
import { type MinimapTick, readWaveGrowth } from "./conversation-minimap-layout";

/**
 * Grows the ticks near the crest without a React render, and gives the crest position to move.
 * The crest follows that position at once. The wave height eases in and out, or changes at once
 * when the system asks for reduced motion.
 */
export function useMinimapWave({
  ticksRef,
  spacing,
  ticks,
  isRaised,
}: {
  ticksRef: RefObject<HTMLDivElement | null>;
  spacing: number;
  ticks: MinimapTick[];
  isRaised: boolean;
}): MotionValue<number> {
  const crestY = useMotionValue(0);
  const waveHeight = useMotionValue(0);
  const shouldReduceMotion = useReducedMotion();
  // The growth last written to each tick row, so a paint skips the rows that did not change.
  const growthsRef = useRef<number[]>([]);

  const paint = useCallback(() => {
    const tickRows = ticksRef.current?.children;
    if (!tickRows) return;
    const y = crestY.get();
    const height = waveHeight.get();
    const growths = growthsRef.current;
    for (let index = 0; index < tickRows.length; index += 1) {
      const row = tickRows[index];
      const growth =
        height === 0 ? 0 : height * readWaveGrowth(Math.abs(y - (index + 0.5) * spacing), spacing);
      if (!(row instanceof HTMLElement) || growths[index] === growth) continue;
      growths[index] = growth;
      row.style.setProperty("--tick-growth", String(growth));
    }
  }, [crestY, spacing, ticksRef, waveHeight]);

  const schedulePaint = useCallback(() => {
    frame.render(paint);
  }, [paint]);
  useMotionValueEvent(crestY, "change", schedulePaint);
  useMotionValueEvent(waveHeight, "change", schedulePaint);

  // A new layout can mount new tick rows without a growth, also when the tick count stays the
  // same, so it paints every row again.
  useLayoutEffect(() => {
    void ticks;
    growthsRef.current = [];
    paint();
  }, [paint, ticks]);

  useEffect(() => {
    const target = isRaised ? 1 : 0;
    if (shouldReduceMotion) {
      waveHeight.set(target);
      return;
    }
    const controls = animate(waveHeight, target, {
      duration: isRaised ? MINIMAP_WAVE_RISE_SECONDS : MINIMAP_WAVE_FALL_SECONDS,
      ease: MOTION_EASE_OUT_POINTS,
    });
    return () => controls.stop();
  }, [isRaised, shouldReduceMotion, waveHeight]);

  return crestY;
}
