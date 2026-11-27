import { HTML_PREVIEW_MAX_CONTENT_HEIGHT } from "@openducktor/contracts";

export type HtmlPreviewHeightGovernorOptions = {
  minHeight?: number;
  maxHeight?: number;
  maxChangesPerWindow?: number;
  windowMs?: number;
  repeatGrowthLimit?: number;
  repeatGrowthDurationMs?: number;
  repeatStepMaxPx?: number;
  repeatGapMaxMs?: number;
  repeatTolerancePx?: number;
  freezeRecoveryQuietMs?: number;
  now?: () => number;
};

export type HtmlPreviewHeightGovernor = {
  /** Returns the next clamped height to apply, or `null` when ignored or growth-frozen. */
  accept(rawHeight: number): number | null;
  /** Resets governor state for a new preview document. */
  reset(initialHeight?: number | null): void;
  /** True while a runaway growth loop has tripped the circuit breaker. */
  isGrowthFrozen(): boolean;
};

const DEFAULT_MIN_HEIGHT = 80;
const DEFAULT_MAX_CHANGES_PER_WINDOW = 60;
const DEFAULT_WINDOW_MS = 1_000;
const DEFAULT_REPEAT_GROWTH_LIMIT = 10;
const DEFAULT_REPEAT_GROWTH_DURATION_MS = 1_000;
const DEFAULT_REPEAT_STEP_MAX_PX = 64;
const DEFAULT_REPEAT_GAP_MAX_MS = 500;
const DEFAULT_REPEAT_TOLERANCE_PX = 1;
const DEFAULT_FREEZE_RECOVERY_QUIET_MS = 1_000;

/**
 * Runtime height governor for auto-sizing HTML preview frames.
 *
 * Clamps reported heights, rate-limits extreme resize bursts without permanently locking the frame,
 * and temporarily freezes upward growth only if a page sustains a repeating incremental growth loop
 * (for example via JS or CSS viewport-height quirks). Finite expand animations finish cleanly,
 * shrinkage stays permitted while frozen, and the breaker recovers after a quiet pause.
 */
export const createHtmlPreviewHeightGovernor = (
  options: HtmlPreviewHeightGovernorOptions = {},
): HtmlPreviewHeightGovernor => {
  const minHeight = options.minHeight ?? DEFAULT_MIN_HEIGHT;
  const maxHeight = options.maxHeight ?? HTML_PREVIEW_MAX_CONTENT_HEIGHT;
  const maxChangesPerWindow = options.maxChangesPerWindow ?? DEFAULT_MAX_CHANGES_PER_WINDOW;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const repeatGrowthLimit = options.repeatGrowthLimit ?? DEFAULT_REPEAT_GROWTH_LIMIT;
  const repeatGrowthDurationMs =
    options.repeatGrowthDurationMs ?? DEFAULT_REPEAT_GROWTH_DURATION_MS;
  const repeatStepMaxPx = options.repeatStepMaxPx ?? DEFAULT_REPEAT_STEP_MAX_PX;
  const repeatGapMaxMs = options.repeatGapMaxMs ?? DEFAULT_REPEAT_GAP_MAX_MS;
  const repeatTolerancePx = options.repeatTolerancePx ?? DEFAULT_REPEAT_TOLERANCE_PX;
  const freezeRecoveryQuietMs = options.freezeRecoveryQuietMs ?? DEFAULT_FREEZE_RECOVERY_QUIET_MS;
  const now = options.now ?? Date.now;

  let currentHeight: number | null = null;
  let growthFrozen = false;
  let lastGrowthActivityAt = 0;
  let recentChangeTimes: number[] = [];
  let lastGrowthStep: number | null = null;
  let lastGrowthAt = 0;
  let repeatGrowthStartAt = 0;
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
      const timestamp = now();
      const isGrowing = currentHeight !== null && nextHeight > currentHeight;

      if (growthFrozen && isGrowing) {
        if (timestamp - lastGrowthActivityAt < freezeRecoveryQuietMs) {
          lastGrowthActivityAt = timestamp;
          return null;
        }
        // The page stopped trying to grow for the full quiet window, so allow settled updates.
        growthFrozen = false;
        repeatGrowthCount = 0;
        lastGrowthStep = null;
      }

      recentChangeTimes = recentChangeTimes.filter((time) => timestamp - time < windowMs);
      if (recentChangeTimes.length >= maxChangesPerWindow) {
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
            repeatGrowthStartAt = timestamp;
          }
          lastGrowthStep = step;
          lastGrowthAt = timestamp;
          if (
            repeatGrowthCount >= repeatGrowthLimit &&
            timestamp - repeatGrowthStartAt >= repeatGrowthDurationMs
          ) {
            growthFrozen = true;
            lastGrowthActivityAt = timestamp;
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
      lastGrowthActivityAt = 0;
      recentChangeTimes = [];
      lastGrowthStep = null;
      lastGrowthAt = 0;
      repeatGrowthStartAt = 0;
      repeatGrowthCount = 0;
    },

    isGrowthFrozen: () => growthFrozen,
  };
};
