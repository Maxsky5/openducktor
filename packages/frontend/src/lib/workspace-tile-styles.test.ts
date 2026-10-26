import { describe, expect, test } from "bun:test";
import {
  noColorTileClasses,
  tileColorFaceStyle,
  tileLabelSizeClass,
} from "./workspace-tile-styles";

describe("tileColorFaceStyle", () => {
  test("returns the opaque color with a label color picked by contrast", () => {
    expect(tileColorFaceStyle("#3b82f6")).toEqual({
      backgroundColor: "#3b82f6",
      color: "#000000",
    });
  });

  test("carries no active marker, so a color sample never reads as an active tile", () => {
    expect(tileColorFaceStyle("#3b82f6")).not.toHaveProperty("outlineColor");
  });
});

describe("noColorTileClasses", () => {
  test("marks the selected tile with the sidebar accent of the active navigation item", () => {
    expect(noColorTileClasses(true)).toBe(
      "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent",
    );
  });

  test("keeps every other tile on the neutral tile surface", () => {
    expect(noColorTileClasses(false)).toBe("bg-workspace-rail-tile hover:bg-workspace-rail-tile");
  });
});

describe("tileLabelSizeClass", () => {
  test("shrinks the label for a 3 character abbreviation", () => {
    expect(tileLabelSizeClass("AB")).toBe("text-xs");
    expect(tileLabelSizeClass("iOS")).toBe("text-[0.625rem]");
  });

  test("counts a decomposed accent as one character", () => {
    // Three UTF-16 units, two tile columns.
    expect(tileLabelSizeClass("E\u0301M")).toBe("text-xs");
  });
});
