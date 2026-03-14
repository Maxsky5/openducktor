import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BORDER_RAY_DEFAULT_LENGTH,
  BORDER_RAY_DEFAULT_LENGTH_MAX,
  BORDER_RAY_DEFAULT_LENGTH_MIN,
  BORDER_RAY_DEFAULT_LENGTH_RATIO,
  BORDER_RAY_DEFAULT_PERIMETER,
  BORDER_RAY_DEFAULT_TURN_DURATION_MS,
  computeBorderRayLength,
  DEFAULT_BORDER_RAY_PATH_METRICS,
} from "@/components/ui/border-ray-model";

describe("border-ray-model", () => {
  test("uses the requested 15% default ratio", () => {
    expect(BORDER_RAY_DEFAULT_LENGTH_RATIO).toBe(0.15);
  });

  test("clamps computed length with default bounds", () => {
    expect(computeBorderRayLength(100)).toBe(BORDER_RAY_DEFAULT_LENGTH_MIN);
    expect(computeBorderRayLength(2000)).toBe(300);
    expect(computeBorderRayLength(4000)).toBe(BORDER_RAY_DEFAULT_LENGTH_MAX);
  });

  test("keeps default path metrics in sync with model constants", () => {
    expect(DEFAULT_BORDER_RAY_PATH_METRICS.perimeter).toBe(BORDER_RAY_DEFAULT_PERIMETER);
    expect(DEFAULT_BORDER_RAY_PATH_METRICS.rayLength).toBe(BORDER_RAY_DEFAULT_LENGTH);
  });

  test("keeps CSS fallbacks aligned with model constants", () => {
    const stylesPath = resolve(import.meta.dir, "../../styles.css");
    const styles = readFileSync(stylesPath, "utf8");

    const durationMatch = styles.match(/--odt-border-ray-turn-duration:\s*([\d.]+)ms\s*;/);
    const perimeterMatch = styles.match(/--odt-border-ray-perimeter:\s*([\d.]+)px\s*;/);
    const lengthMatch = styles.match(/--odt-border-ray-length:\s*([\d.]+)px\s*;/);

    expect(durationMatch).not.toBeNull();
    expect(perimeterMatch).not.toBeNull();
    expect(lengthMatch).not.toBeNull();

    expect(Number(durationMatch?.[1])).toBe(BORDER_RAY_DEFAULT_TURN_DURATION_MS);
    expect(Number(perimeterMatch?.[1])).toBe(BORDER_RAY_DEFAULT_PERIMETER);
    expect(Number(lengthMatch?.[1])).toBe(BORDER_RAY_DEFAULT_LENGTH);
    expect(styles).not.toContain("--kanban-ray-");
  });
});
