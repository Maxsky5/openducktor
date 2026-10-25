import { describe, expect, test } from "bun:test";
import {
  CRADLE_HALF_WIDTH,
  CREATE_HIT_SLOP,
  CREATE_RISE,
  RAIL_CREATE_HIT_SLOP,
  RAIL_WIDTH,
  railCreateCenter,
  TAB_BAR,
  tabBarEdgePath,
  tabBarPath,
} from "./tab-bar-geometry";

const points = (path: string): [number, number][] =>
  [...path.matchAll(/(?:M|L) (\S+) (\S+)|A \S+ \S+ \S+ \S+ \S+ (\S+) (\S+)/g)].map((match) => [
    Number(match[1] ?? match[3]),
    Number(match[2] ?? match[4]),
  ]);

describe("tab bar outline", () => {
  test("dips into a cradle that is centered on the create button", () => {
    const [start, shoulderStart, leftMeet, rightMeet, shoulderEnd, end] = points(
      tabBarEdgePath(400),
    );
    expect(start).toEqual([0, 0]);
    expect(end).toEqual([400, 0]);
    expect(shoulderStart?.[0]).toBeCloseTo(200 - CRADLE_HALF_WIDTH);
    expect(shoulderEnd?.[0]).toBeCloseTo(200 + CRADLE_HALF_WIDTH);
    expect((leftMeet?.[0] ?? 0) + (rightMeet?.[0] ?? 0)).toBeCloseTo(400);
    expect(leftMeet?.[1]).toBeCloseTo(rightMeet?.[1] ?? Number.NaN);
  });

  test("keeps the gap around the create button where the shoulders meet the cradle", () => {
    const [, , leftMeet] = points(tabBarEdgePath(400));
    const distance = Math.hypot(
      (leftMeet?.[0] ?? 0) - 200,
      (leftMeet?.[1] ?? 0) + TAB_BAR.createLift,
    );
    expect(distance).toBeCloseTo(TAB_BAR.createSize / 2 + TAB_BAR.cradleGap);
  });

  test("closes the outline along the bottom edge", () => {
    expect(tabBarPath(400, 90).endsWith("L 400 90 L 0 90 Z")).toBe(true);
  });
});

describe("create button target", () => {
  test("fills the slot of the cradle from the top of the button to the bottom of the row", () => {
    const width = TAB_BAR.createSize + CREATE_HIT_SLOP.left + CREATE_HIT_SLOP.right;
    expect(width).toBeCloseTo(2 * CRADLE_HALF_WIDTH);
    // The button starts at the top of the dock, and the row ends CREATE_RISE + height below it.
    expect(TAB_BAR.createSize + CREATE_HIT_SLOP.top + CREATE_HIT_SLOP.bottom).toBe(
      CREATE_RISE + TAB_BAR.height,
    );
  });
});

describe("rail", () => {
  test("puts the create button on the right edge, as high in the rail as in the bar", () => {
    // The center sits as deep in the rail as in the bar, so the button rises past the edge by the
    // same amount.
    expect(railCreateCenter(24) + TAB_BAR.createSize / 2).toBe(24 + RAIL_WIDTH + CREATE_RISE);
  });

  test("gives the create button the touches of its slot, down to the left edge of the rail", () => {
    const buttonLeft = railCreateCenter(0) - TAB_BAR.createSize / 2;
    expect(buttonLeft - RAIL_CREATE_HIT_SLOP.left).toBe(0);
    expect(TAB_BAR.createSize + RAIL_CREATE_HIT_SLOP.top + RAIL_CREATE_HIT_SLOP.bottom).toBeCloseTo(
      2 * CRADLE_HALF_WIDTH,
    );
  });
});
