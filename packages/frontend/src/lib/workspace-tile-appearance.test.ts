import { describe, expect, test } from "bun:test";
import {
  WORKSPACE_TILE_PALETTE,
  deriveWorkspaceInitials,
  normalizeHexInput,
  tileColorFaceStyle,
  tileForegroundColor,
  tileLabelSizeClass,
  tileShadeRamp,
} from "./workspace-tile-appearance";

describe("deriveWorkspaceInitials", () => {
  test("takes the first letter of the first two words", () => {
    expect(deriveWorkspaceInitials("openducktor app")).toBe("OA");
  });

  test("takes the first two characters of a single word", () => {
    expect(deriveWorkspaceInitials("openducktor")).toBe("OP");
  });

  test("returns a question mark for a blank name", () => {
    expect(deriveWorkspaceInitials("   ")).toBe("?");
  });

  test("keeps a leading letter from any script", () => {
    expect(deriveWorkspaceInitials("Équipe Mobile")).toBe("ÉM");
  });

  test("skips leading punctuation on a single word", () => {
    expect(deriveWorkspaceInitials("_alpha")).toBe("AL");
  });

  test("keeps a decomposed accent with its base letter", () => {
    // macOS reports directory names decomposed, and a workspace name often starts as one.
    expect(deriveWorkspaceInitials("E\u0301quipe Mobile")).toBe("E\u0301M");
  });

  test("never splits a letter outside the basic plane", () => {
    expect(deriveWorkspaceInitials("\u{1D49C}lpha Beta")).toBe("\u{1D49C}B");
    expect(deriveWorkspaceInitials("\u{1D49C}lpha")).toBe("\u{1D49C}L");
  });
});

describe("normalizeHexInput", () => {
  test("accepts a 6-digit value with an optional hash in any case", () => {
    expect(normalizeHexInput("F08C00")).toBe("#f08c00");
    expect(normalizeHexInput(" #f08c00 ")).toBe("#f08c00");
  });

  test.each(["f08c0", "f08c000", "gggggg", "", "#"])("rejects %p", (raw) => {
    expect(normalizeHexInput(raw)).toBeNull();
  });
});

describe("tileShadeRamp", () => {
  test("returns five variants from the lightest to the darkest", () => {
    const shades = tileShadeRamp("#3b82f6");
    expect(shades).toHaveLength(5);
    expect(shades.map((shade) => shade.level)).toEqual([1, 2, 3, 4, 5]);
    expect(shades.map((shade) => shade.lightnessPercent)).toEqual([88, 72, 56, 40, 26]);
    expect(shades.every((shade) => /^#[0-9a-f]{6}$/.test(shade.hex))).toBe(true);
  });

  test("keeps every shade inside its own ramp so a picked shade stays marked", () => {
    for (const shade of tileShadeRamp("#3b82f6")) {
      expect(tileShadeRamp(shade.hex).map((entry) => entry.hex)).toContain(shade.hex);
    }
  });

  test("keeps a neutral color neutral", () => {
    for (const shade of tileShadeRamp("#808080")) {
      expect(shade.hex.slice(1, 3)).toBe(shade.hex.slice(3, 5));
      expect(shade.hex.slice(3, 5)).toBe(shade.hex.slice(5, 7));
    }
  });
});

const contrastAgainst = (left: string, right: string): number => {
  const luminance = (hex: string): number => {
    const channel = (value: number): number => {
      const normalized = value / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    return (
      0.2126 * channel(Number.parseInt(hex.slice(1, 3), 16)) +
      0.7152 * channel(Number.parseInt(hex.slice(3, 5), 16)) +
      0.0722 * channel(Number.parseInt(hex.slice(5, 7), 16))
    );
  };
  return (
    (Math.max(luminance(left), luminance(right)) + 0.05) /
    (Math.min(luminance(left), luminance(right)) + 0.05)
  );
};

describe("tileForegroundColor", () => {
  test("uses dark text on a light color and light text on a dark color", () => {
    expect(tileForegroundColor("#f8fafc")).toBe("#000000");
    expect(tileForegroundColor("#1e293b")).toBe("#ffffff");
  });

  test("keeps a color outside the palette readable at a 4.5 contrast ratio", () => {
    // `#7b7b7b` reached only 4.23 against the softer dark label color used before.
    for (const hex of ["#7b7b7b", "#777777", "#757575", "#808080", "#1e7abe"]) {
      expect(contrastAgainst(hex, tileForegroundColor(hex))).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("keeps every palette color readable at a 4.5 contrast ratio", () => {
    const luminance = (hex: string): number => {
      const channel = (value: number): number => {
        const normalized = value / 255;
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      return (
        0.2126 * channel(Number.parseInt(hex.slice(1, 3), 16)) +
        0.7152 * channel(Number.parseInt(hex.slice(3, 5), 16)) +
        0.0722 * channel(Number.parseInt(hex.slice(5, 7), 16))
      );
    };

    for (const entry of WORKSPACE_TILE_PALETTE) {
      const foreground = tileForegroundColor(entry.hex);
      const lighter = Math.max(luminance(entry.hex), luminance(foreground));
      const darker = Math.min(luminance(entry.hex), luminance(foreground));
      expect((lighter + 0.05) / (darker + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

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
