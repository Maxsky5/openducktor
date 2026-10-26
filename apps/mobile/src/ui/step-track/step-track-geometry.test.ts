import { describe, expect, test } from "bun:test";
import {
  BUMP_HEIGHT,
  centerFor,
  EDGE_PAD,
  labelCenter,
  nearestEnabled,
  plateauFor,
  shellPath,
  TRACK_HEIGHT,
  TRACK_RADIUS,
  thumbBounds,
  tickHeight,
  valueAt,
} from "./step-track-geometry";

const TRACK = 224;

describe("step track geometry", () => {
  test("puts the first and last stops one radius from the ends", () => {
    expect(centerFor(0, 4, TRACK)).toBe(TRACK_RADIUS);
    expect(centerFor(3, 4, TRACK)).toBe(TRACK - TRACK_RADIUS);
    expect(valueAt(centerFor(2, 4, TRACK), 4, TRACK)).toBeCloseTo(2);
  });

  test("keeps a touch outside the stops on the nearest end", () => {
    expect(valueAt(-40, 4, TRACK)).toBe(0);
    expect(valueAt(TRACK + 40, 4, TRACK)).toBe(3);
  });

  test("draws a plain pill while the label is closed", () => {
    expect(shellPath(centerFor(1, 4, TRACK), 0, plateauFor(64), TRACK)).toBe(
      `M16 ${BUMP_HEIGHT}H208A16 16 0 0 1 208 ${BUMP_HEIGHT + TRACK_HEIGHT}H16A16 16 0 0 1 16 ${BUMP_HEIGHT}Z`,
    );
  });

  test("grows the label shoulder to the top while the label is open", () => {
    const path = shellPath(centerFor(1, 4, TRACK), 1, plateauFor(64), TRACK);
    // The left shoulder ends on the top edge, where the flat top of the label starts.
    expect(path).toMatch(/ 0\.00H/);
    expect(path.endsWith(`A16 16 0 0 1 208 ${BUMP_HEIGHT + TRACK_HEIGHT}H16Z`)).toBe(true);
  });

  test("keeps the label over the track at both ends", () => {
    const plateau = plateauFor(64);
    const half = 32;
    expect(labelCenter(centerFor(0, 4, TRACK), plateau, TRACK) - half).toBeGreaterThan(0);
    expect(labelCenter(centerFor(3, 4, TRACK), plateau, TRACK) + half).toBeLessThan(TRACK);
  });

  test("keeps the thumb inside the track and grows it while the label is open", () => {
    const first = thumbBounds(centerFor(0, 4, TRACK), 0, TRACK);
    const last = thumbBounds(centerFor(3, 4, TRACK), 1, TRACK);
    expect(first.left).toBe(EDGE_PAD);
    expect(last.right).toBe(TRACK - EDGE_PAD);
    expect(last.right - last.left).toBeGreaterThan(first.right - first.left);
  });

  test("grows the ticks from the first stop to the last", () => {
    expect(tickHeight(0, 4)).toBe(4.8);
    expect(tickHeight(3, 4)).toBe(9.6);
    expect(tickHeight(1, 4)).toBeLessThan(tickHeight(2, 4));
  });

  test("moves a choice off a disabled stop to the nearest stop that the user can choose", () => {
    expect(nearestEnabled(1, [false, true, false])).toBe(0);
    expect(nearestEnabled(1, [true, true, false])).toBe(2);
    expect(nearestEnabled(0, [true, true])).toBeNull();
  });
});
