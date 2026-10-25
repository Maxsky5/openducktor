import { describe, expect, test } from "bun:test";
import { keepAspectRatio, knownAspectRatio } from "./image-aspect-ratio";

describe("keepAspectRatio", () => {
  test("keeps the ratio of the first load when a later load decodes at another size", () => {
    expect(keepAspectRatio("generated-image:row-1", 1)).toBe(1);
    expect(keepAspectRatio("generated-image:row-1", 1008 / 1007)).toBe(1);
    expect(knownAspectRatio("generated-image:row-1")).toBe(1);
  });
});
