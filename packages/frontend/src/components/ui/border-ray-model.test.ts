import { describe, expect, test } from "bun:test";
import {
  BORDER_RAY_DEFAULT_LENGTH_MAX,
  BORDER_RAY_DEFAULT_LENGTH_MIN,
  BORDER_RAY_DEFAULT_LENGTH_RATIO,
  type BorderRayStop,
  computeBorderRayGeometry,
  computeBorderRayLength,
  computeBorderRayStops,
} from "@/components/ui/border-ray-model";

const OPTIONS = {
  insetOffset: -1,
  strokeWidth: 2.6,
  rayLengthRatio: BORDER_RAY_DEFAULT_LENGTH_RATIO,
  rayLengthMin: BORDER_RAY_DEFAULT_LENGTH_MIN,
  rayLengthMax: BORDER_RAY_DEFAULT_LENGTH_MAX,
};

/** The distance of the stops at one point of the turn, as the linear animation interpolates. */
const distanceAt = (stops: BorderRayStop[], phase: number): number => {
  let from: BorderRayStop | undefined;
  for (const to of stops) {
    if (from && phase >= from.offset && phase < to.offset) {
      return (
        from.distance +
        ((to.distance - from.distance) * (phase - from.offset)) / (to.offset - from.offset)
      );
    }
    from = to;
  }
  throw new Error(`No stop covers phase ${phase}.`);
};

describe("border-ray-model", () => {
  test("clamps computed length with default bounds", () => {
    expect(computeBorderRayLength(100)).toBe(BORDER_RAY_DEFAULT_LENGTH_MIN);
    expect(computeBorderRayLength(2000)).toBe(300);
    expect(computeBorderRayLength(4000)).toBe(BORDER_RAY_DEFAULT_LENGTH_MAX);
  });

  test("moves the tail of each edge bar with the ray around the whole border", () => {
    const travel = 1000;
    const length = 120;
    for (const edgeStart of [0, 300, 500, 800]) {
      const stops = computeBorderRayStops(edgeStart, travel, length);
      for (const phase of [0, 0.1, 0.25, 0.42, 0.5, 0.67, 0.79, 0.95]) {
        const tail = phase * travel;
        // The edge sees the ray tail at this distance from its start, one turn back or ahead.
        const expected = ((((tail - edgeStart + length) % travel) + travel) % travel) - length;
        expect(distanceAt(stops, phase)).toBeCloseTo(expected, 6);
      }
    }
  });

  test("jumps a bar back only while the bar is off its edge", () => {
    const travel = 1000;
    const length = 120;
    const stops = computeBorderRayStops(300, travel, length);
    const jump = stops.findIndex((stop, index) => stops[index + 1]?.offset === stop.offset);

    // The bar leaves the far end of the longest possible edge and comes back before its start.
    expect(stops[jump]?.distance).toBe(travel - length);
    expect(travel - length).toBeGreaterThanOrEqual(travel / 2);
    expect(stops[jump + 1]?.distance).toBe(-length);
  });

  test("keeps the ray within half a turn so each bar leaves its edge before it jumps", () => {
    const geometry = computeBorderRayGeometry(
      { width: 60, height: 20, radius: 8, borderWidth: 1 },
      { ...OPTIONS, rayLengthMin: 500, rayLengthMax: 500 },
    );
    const top = geometry.segments.find((segment) => segment.edge === "top");

    // The path box is 61 by 21 pixels, so a turn travels 164 pixels.
    expect(top?.barWidth).toBe(82);
  });

  test("puts the outer half of the stroke inside the layer", () => {
    const geometry = computeBorderRayGeometry(
      { width: 600, height: 90, radius: 12, borderWidth: 1 },
      OPTIONS,
    );

    expect(geometry.margin).toBe(3);
    expect(geometry.width).toBe(606);
    expect(geometry.height).toBe(96);
    expect(geometry.segments.map((segment) => segment.edge)).toEqual([
      "top",
      "right",
      "bottom",
      "left",
    ]);
    for (const segment of geometry.segments) {
      expect(segment.clipPath.startsWith('path("M ')).toBe(true);
    }
    // The ray starts at the top-left corner of the path box, 2.5 pixels into the layer.
    expect(geometry.segments[0]?.keyframes[0]).toEqual({
      offset: 0,
      transform: "translate(2.5px, 0px)",
    });
  });
});
