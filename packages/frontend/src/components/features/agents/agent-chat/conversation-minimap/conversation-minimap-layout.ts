import {
  MINIMAP_MIN_TICK_SPACING_PX,
  MINIMAP_TICK_SPACING_PX,
  MINIMAP_WAVE_RADIUS_PX,
} from "./constants";

/** A tick for the user messages from `firstMessage` up to, but not including, `endMessage`. */
export type MinimapTick = {
  firstMessage: number;
  endMessage: number;
};

export type MinimapLayout = {
  spacing: number;
  ticks: MinimapTick[];
};

/**
 * Gives one tick per message at the default spacing, then a smaller spacing down to the minimum. When
 * the ticks still do not fit, consecutive messages share ticks in groups whose sizes differ by at
 * most one. The layout uses whole pixels, so ticks stay sharp.
 */
export const layoutConversationMinimap = (
  messageCount: number,
  maxHeight: number,
): MinimapLayout => {
  if (messageCount * MINIMAP_TICK_SPACING_PX <= maxHeight) {
    return { spacing: MINIMAP_TICK_SPACING_PX, ticks: groupMessages(messageCount, messageCount) };
  }

  const tickCount = Math.max(
    1,
    Math.min(messageCount, Math.floor(maxHeight / MINIMAP_MIN_TICK_SPACING_PX)),
  );
  return {
    spacing: Math.max(MINIMAP_MIN_TICK_SPACING_PX, Math.floor(maxHeight / tickCount)),
    ticks: groupMessages(messageCount, tickCount),
  };
};

export const findTickOfMessage = (ticks: MinimapTick[], message: number): number => {
  let low = 0;
  let high = ticks.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const tick = ticks[middle];
    if (tick && tick.firstMessage <= message) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
};

/**
 * Tells how much a tick grows, from 0 at rest to 1 at full length, for its distance to the crest.
 * The tick under the crest grows fully. Its neighbors taper smoothly to rest.
 */
export const readWaveGrowth = (distancePx: number, spacing: number): number => {
  const taper = (distancePx - spacing / 2) / MINIMAP_WAVE_RADIUS_PX;
  if (taper <= 0) {
    return 1;
  }
  if (taper >= 1) {
    return 0;
  }
  return (1 + Math.cos(Math.PI * taper)) / 2;
};

function groupMessages(messageCount: number, tickCount: number): MinimapTick[] {
  return Array.from({ length: tickCount }, (_, tick) => ({
    firstMessage: Math.floor((tick * messageCount) / tickCount),
    endMessage: Math.floor(((tick + 1) * messageCount) / tickCount),
  }));
}
