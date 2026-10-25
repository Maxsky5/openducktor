import { describe, expect, test } from "bun:test";
import { rayPath, rayPointAt } from "./border-ray-path";

const card = rayPath({ width: 200, height: 100 }, 12);

describe("rayPath", () => {
  test("measures the edge as the desktop ray does", () => {
    // The ray runs half a point outside the card, so the edge is 201 by 101 with 12.5 corners.
    expect(card.radius).toBe(12.5);
    expect(card.perimeter).toBeCloseTo(2 * (201 + 101 - 4 * 12.5) + 2 * Math.PI * 12.5);
    expect(card.rayLength).toBe(Math.max(card.perimeter * 0.12, 50));
  });

  test("keeps the ray length between 50 and 320 points", () => {
    expect(rayPath({ width: 20, height: 20 }, 4).rayLength).toBe(50);
    expect(rayPath({ width: 2000, height: 1000 }, 4).rayLength).toBe(320);
  });
});

describe("rayPointAt", () => {
  test("runs clockwise along each edge", () => {
    expect(rayPointAt(card, 0)).toEqual({ x: -0.5 + 12.5, y: -0.5, angle: 0 });
    const right = rayPointAt(card, card.across + card.arc + 10);
    expect(right.x).toBeCloseTo(200.5);
    expect(right.y).toBeCloseTo(-0.5 + 12.5 + 10);
    expect(right.angle).toBeCloseTo(Math.PI / 2);
    const bottom = rayPointAt(card, card.across + card.down + 2 * card.arc + 10);
    expect(bottom.y).toBeCloseTo(100.5);
    expect(bottom.angle).toBeCloseTo(Math.PI);
  });

  test("follows the corner arcs and wraps around the edge", () => {
    const corner = rayPointAt(card, card.across + card.arc / 2);
    const center = { x: 200.5 - 12.5, y: -0.5 + 12.5 };
    expect(Math.hypot(corner.x - center.x, corner.y - center.y)).toBeCloseTo(12.5);
    expect(corner.angle).toBeCloseTo(Math.PI / 4);
    expect(rayPointAt(card, card.perimeter + 5)).toEqual(rayPointAt(card, 5));
    expect(rayPointAt(card, -5).x).toBeCloseTo(rayPointAt(card, card.perimeter - 5).x);
  });

  test("rounds a square card by the half point that the ray runs outside it", () => {
    const square = rayPath({ width: 10, height: 10 }, 0);
    expect(square.radius).toBe(0.5);
    const right = rayPointAt(square, square.across + square.arc + 2);
    expect(right.x).toBeCloseTo(10.5);
    expect(right.angle).toBeCloseTo(Math.PI / 2);
  });
});
