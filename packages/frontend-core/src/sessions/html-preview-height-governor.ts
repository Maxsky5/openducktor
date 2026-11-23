import { HTML_PREVIEW_MAX_CONTENT_HEIGHT } from "@openducktor/contracts";

export type HtmlPreviewHeightGovernorOptions = {
  minHeight?: number;
  maxHeight?: number;
  maxChangesPerWindow?: number;
  windowMs?: number;
  repeatGrowthLimit?: number;
  repeatStepMaxPx?: number;
  repeatGapMaxMs?: number;
  repeatTolerancePx?: number;
  now?: () => number;
};

export type HtmlPreviewHeightGovernor = {
  /** Returns the next clamped height to apply, or `null` when ignored or growth-frozen. */
  accept(rawHeight: number): number | null;
  /** Resets governor state for a new preview document. */
  reset(initialHeight?: number | null): void;
  /** True once a runaway growth loop tripped the circuit breaker. */
  isGrowthFrozen(): boolean;
};

const DEFAULT_MIN_HEIGHT = 80;
const DEFAULT_MAX_CHANGES_PER_WINDOW = 20;
const DEFAULT_WINDOW_MS = 1_000;
const DEFAULT_REPEAT_GROWTH_LIMIT = 10;
const DEFAULT_REPEAT_STEP_MAX_PX = 64;
const DEFAULT_REPEAT_GAP_MAX_MS = 500;
const DEFAULT_REPEAT_TOLERANCE_PX = 1;

/**
 * Runtime height governor for auto-sizing HTML preview frames.
 *
 * Clamps reported heights, rate-limits resize bursts, and freezes upward growth if a page enters
 * a repeating incremental growth feedback loop (for example via JS or CSS viewport-height quirks).
 * Shrinkage remains permitted even after upward growth is frozen.
 */
export const createHtmlPreviewHeightGovernor = (
  options: HtmlPreviewHeightGovernorOptions = {},
): HtmlPreviewHeightGovernor => {
  const minHeight = options.minHeight ?? DEFAULT_MIN_HEIGHT;
  const maxHeight = options.maxHeight ?? HTML_PREVIEW_MAX_CONTENT_HEIGHT;
  const maxChangesPerWindow = options.maxChangesPerWindow ?? DEFAULT_MAX_CHANGES_PER_WINDOW;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const repeatGrowthLimit = options.repeatGrowthLimit ?? DEFAULT_REPEAT_GROWTH_LIMIT;
  const repeatStepMaxPx = options.repeatStepMaxPx ?? DEFAULT_REPEAT_STEP_MAX_PX;
  const repeatGapMaxMs = options.repeatGapMaxMs ?? DEFAULT_REPEAT_GAP_MAX_MS;
  const repeatTolerancePx = options.repeatTolerancePx ?? DEFAULT_REPEAT_TOLERANCE_PX;
  const now = options.now ?? Date.now;

  let currentHeight: number | null = null;
  let growthFrozen = false;
  let recentChangeTimes: number[] = [];
  let lastGrowthStep: number | null = null;
  let lastGrowthAt = 0;
  let repeatGrowthCount = 0;

  const clamp = (height: number): number =>
    Math.max(minHeight, Math.min(maxHeight, Math.ceil(height)));

  return {
    accept: (rawHeight) => {
      if (!Number.isFinite(rawHeight) || rawHeight <= 0) {
        return null;
      }
      const nextHeight = clamp(rawHeight);
      if (currentHeight !== null && nextHeight === currentHeight) {
        return null;
      }
      const isGrowing = currentHeight !== null && nextHeight > currentHeight;
      if (growthFrozen && isGrowing) {
        return null;
      }

      const timestamp = now();
      recentChangeTimes = recentChangeTimes.filter((time) => timestamp - time < windowMs);
      if (recentChangeTimes.length >= maxChangesPerWindow) {
        if (isGrowing) {
          growthFrozen = true;
        }
        return null;
      }

      if (isGrowing && currentHeight !== null) {
        const step = nextHeight - currentHeight;
        if (step <= repeatStepMaxPx) {
          if (
            lastGrowthStep !== null &&
            Math.abs(step - lastGrowthStep) <= repeatTolerancePx &&
            timestamp - lastGrowthAt <= repeatGapMaxMs
          ) {
            repeatGrowthCount += 1;
          } else {
            repeatGrowthCount = 1;
          }
          lastGrowthStep = step;
          lastGrowthAt = timestamp;
          if (repeatGrowthCount >= repeatGrowthLimit) {
            growthFrozen = true;
            return null;
          }
        } else {
          repeatGrowthCount = 0;
          lastGrowthStep = null;
        }
      } else {
        repeatGrowthCount = 0;
        lastGrowthStep = null;
      }

      currentHeight = nextHeight;
      recentChangeTimes.push(timestamp);
      return nextHeight;
    },

    reset: (initialHeight = null) => {
      currentHeight =
        initialHeight !== null && Number.isFinite(initialHeight) && initialHeight > 0
          ? clamp(initialHeight)
          : null;
      growthFrozen = false;
      recentChangeTimes = [];
      lastGrowthStep = null;
      lastGrowthAt = 0;
      repeatGrowthCount = 0;
    },

    isGrowthFrozen: () => growthFrozen,
  };
};
