import { describe, expect, test } from "bun:test";
import {
  cellStartOffset,
  createFoldMotionController,
  type FoldMotion,
  foldMotion,
} from "./transcript-fold-motion";

describe("foldMotion", () => {
  test("keeps the opened row in place and moves the rows under it while the latest row is out of view", () => {
    const motion = foldMotion({
      id: 1,
      pivot: 5,
      inverted: true,
      latestRowInView: false,
      delta: 120,
    });

    // The latest list is inverted, so the rows under the pivot have lower indices.
    expect(cellStartOffset(motion, 3)).toBe(-120);
    expect(cellStartOffset(motion, 5)).toBe(0);
    expect(cellStartOffset(motion, 8)).toBe(0);
  });

  test("keeps the latest row in place and moves the opened row and the rows over it", () => {
    const motion = foldMotion({
      id: 1,
      pivot: 5,
      inverted: true,
      latestRowInView: true,
      delta: 120,
    });

    expect(cellStartOffset(motion, 3)).toBe(0);
    expect(cellStartOffset(motion, 5)).toBe(120);
    expect(cellStartOffset(motion, 8)).toBe(120);
  });

  test("starts the rows of a fold where they were, and moves the rows under it in a list that is not inverted", () => {
    const motion = foldMotion({
      id: 1,
      pivot: 5,
      inverted: false,
      latestRowInView: true,
      delta: -80,
    });

    expect(cellStartOffset(motion, 7)).toBe(80);
    expect(cellStartOffset(motion, 5)).toBe(0);
    expect(cellStartOffset(null, 7)).toBe(0);
  });
});

describe("createFoldMotionController", () => {
  test("starts a motion, runs it once, and ends it after its time", async () => {
    let motion: FoldMotion | null = null;
    const motions = createFoldMotionController((update) => {
      motion = update(motion);
    });
    const id = motions.nextId();
    motions.start(
      foldMotion({ id, pivot: 2, inverted: true, latestRowInView: false, delta: 40 }),
      20,
    );

    expect(motion).toMatchObject({ id, phase: "start" });
    motions.advance(id + 1);
    expect(motion).toMatchObject({ phase: "start" });
    motions.advance(id);
    expect(motion).toMatchObject({ phase: "run" });
    const running = motion;
    motions.advance(id);
    expect(motion).toBe(running);
    expect(motions.nextId()).toBe(id + 1);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(motion).toBeNull();
  });
});
