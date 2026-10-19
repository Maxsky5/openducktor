import { describe, expect, test } from "bun:test";
import {
  MINIMAP_MIN_TICK_SPACING_PX,
  MINIMAP_TICK_SPACING_PX,
  MINIMAP_WAVE_RADIUS_PX,
} from "./constants";
import {
  findTickOfMessage,
  layoutConversationMinimap,
  readWaveGrowth,
} from "./conversation-minimap-layout";

const groupSizes = (messageCount: number, maxHeight: number): number[] =>
  layoutConversationMinimap(messageCount, maxHeight).ticks.map(
    (tick) => tick.endMessage - tick.firstMessage,
  );

describe("layoutConversationMinimap", () => {
  test("gives one tick per message at the default spacing when the ticks fit", () => {
    const layout = layoutConversationMinimap(5, 400);

    expect(layout.spacing).toBe(MINIMAP_TICK_SPACING_PX);
    expect(layout.ticks).toEqual(
      [0, 1, 2, 3, 4].map((m) => ({ firstMessage: m, endMessage: m + 1 })),
    );
  });

  test("moves ticks closer down to the minimum spacing before it groups messages", () => {
    const layout = layoutConversationMinimap(50, 400);

    expect(layout.spacing).toBe(8);
    expect(groupSizes(50, 400).every((size) => size === 1)).toBe(true);
  });

  test("groups consecutive messages in sizes that differ by at most one", () => {
    const layout = layoutConversationMinimap(500, 400);
    const sizes = groupSizes(500, 400);

    expect(layout.ticks).toHaveLength(Math.floor(400 / MINIMAP_MIN_TICK_SPACING_PX));
    expect(layout.spacing * layout.ticks.length).toBeLessThanOrEqual(400);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect(sizes.reduce((total, size) => total + size, 0)).toBe(500);
    layout.ticks.forEach((tick, index) => {
      expect(tick.firstMessage).toBe(layout.ticks[index - 1]?.endMessage ?? 0);
    });
  });

  test("keeps a single tick when the rail has almost no room", () => {
    expect(layoutConversationMinimap(3, 0).ticks).toEqual([{ firstMessage: 0, endMessage: 3 }]);
  });

  test("finds the tick that holds a message", () => {
    const { ticks } = layoutConversationMinimap(500, 400);

    for (const message of [0, 7, 250, 499]) {
      const tick = ticks[findTickOfMessage(ticks, message)];
      expect(tick?.firstMessage).toBeLessThanOrEqual(message);
      expect(tick?.endMessage).toBeGreaterThan(message);
    }
  });
});

describe("readWaveGrowth", () => {
  test("grows the tick under the crest fully and tapers its neighbors to rest", () => {
    const spacing = MINIMAP_TICK_SPACING_PX;

    expect(readWaveGrowth(0, spacing)).toBe(1);
    expect(readWaveGrowth(spacing / 2, spacing)).toBe(1);
    expect(readWaveGrowth(spacing, spacing)).toBeLessThan(1);
    expect(readWaveGrowth(spacing * 2, spacing)).toBeLessThan(readWaveGrowth(spacing, spacing));
    expect(readWaveGrowth(spacing / 2 + MINIMAP_WAVE_RADIUS_PX, spacing)).toBe(0);
  });
});
