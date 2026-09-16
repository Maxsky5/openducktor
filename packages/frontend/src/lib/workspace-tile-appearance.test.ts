import { describe, expect, test } from "bun:test";
import {
  WORKSPACE_TILE_PALETTE,
  deriveWorkspaceInitials,
  normalizeHexInput,
  resolveAutomaticTileColors,
  resolveTileColor,
  ACTIVE_TILE_BORDER_WIDTH_PX,
  tileColorFaceStyle,
  tileForegroundColor,
  tileLabelSizeClass,
  tileShadeRamp,
  tileSurfaceStyle,
} from "./workspace-tile-appearance";

const paletteHexValues = new Set(WORKSPACE_TILE_PALETTE.map((entry) => entry.hex));

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
});

describe("resolveAutomaticTileColors", () => {
  test("gives every workspace a palette color", () => {
    const colors = resolveAutomaticTileColors(["alpha", "beta", "gamma"]);
    expect([...colors.values()].every((hex) => paletteHexValues.has(hex))).toBe(true);
  });

  test("never repeats a color while the palette has a free slot", () => {
    const workspaceIds = Array.from({ length: WORKSPACE_TILE_PALETTE.length }, (_, index) =>
      String(index),
    );
    const colors = resolveAutomaticTileColors(workspaceIds);
    expect(new Set(colors.values()).size).toBe(WORKSPACE_TILE_PALETTE.length);
  });

  test("keeps an assignment stable when the rail order changes", () => {
    const ordered = resolveAutomaticTileColors(["alpha", "beta", "gamma"]);
    const reordered = resolveAutomaticTileColors(["gamma", "alpha", "beta"]);
    expect([...reordered.entries()]).toEqual([...ordered.entries()]);
  });

  test("repeats a color only after the palette is exhausted", () => {
    const workspaceIds = Array.from({ length: WORKSPACE_TILE_PALETTE.length + 3 }, (_, index) =>
      String(index),
    );
    const colors = resolveAutomaticTileColors(workspaceIds);
    expect(colors.size).toBe(workspaceIds.length);
    expect(new Set(colors.values()).size).toBe(WORKSPACE_TILE_PALETTE.length);
  });
});

describe("resolveTileColor", () => {
  const automaticColors = resolveAutomaticTileColors(["alpha", "beta"]);

  test("prefers the color the user picked", () => {
    expect(
      resolveTileColor({ workspaceId: "alpha", pickedColor: "#123456", automaticColors }),
    ).toBe("#123456");
  });

  test("falls back to the automatic color when nothing is picked", () => {
    const alphaAutomaticColor = automaticColors.get("alpha");
    expect(alphaAutomaticColor).toBeDefined();
    expect(resolveTileColor({ workspaceId: "alpha", pickedColor: null, automaticColors })).toBe(
      alphaAutomaticColor ?? "",
    );
  });

  test("gives a palette color to an id outside the assignment", () => {
    const resolved = resolveTileColor({
      workspaceId: "unknown",
      pickedColor: null,
      automaticColors,
    });
    expect(paletteHexValues.has(resolved)).toBe(true);
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

describe("tileSurfaceStyle", () => {
  test("uses the opaque color and a wide primary border for the active tile", () => {
    expect(tileSurfaceStyle("#3b82f6", { isActive: true })).toEqual({
      backgroundColor: "#3b82f6",
      color: "#000000",
      outlineWidth: `${ACTIVE_TILE_BORDER_WIDTH_PX}px`,
      outlineStyle: "solid",
      outlineColor: "var(--primary)",
      outlineOffset: `-${ACTIVE_TILE_BORDER_WIDTH_PX}px`,
    });
  });

  test("marks the active tile with a border that does not depend on the tile color", () => {
    const markers = WORKSPACE_TILE_PALETTE.map(
      (entry) => tileSurfaceStyle(entry.hex, { isActive: true }).outlineColor,
    );

    expect(new Set(markers)).toEqual(new Set(["var(--primary)"]));
  });

  test("shows an inactive tile at full strength and leaves it unmarked", () => {
    expect(tileSurfaceStyle("#3b82f6", { isActive: false })).toEqual({
      backgroundColor: "#3b82f6",
      color: "#000000",
    });
  });

  test("separates the active tile from a neighbor of any intensity through the border alone", () => {
    const lightShade = tileShadeRamp("#3b82f6")[0]?.hex ?? "";
    const activeLight = tileSurfaceStyle(lightShade, { isActive: true });
    const inactiveDark = tileSurfaceStyle("#06347f", { isActive: false });

    expect(activeLight.outlineColor).toBe("var(--primary)");
    expect(activeLight.outlineWidth).toBe(`${ACTIVE_TILE_BORDER_WIDTH_PX}px`);
    expect(inactiveDark).not.toHaveProperty("outlineColor");
    expect(inactiveDark.backgroundColor).toBe("#06347f");
  });
});

describe("tileLabelSizeClass", () => {
  test("shrinks the label for a 3 character abbreviation", () => {
    expect(tileLabelSizeClass("AB")).toBe("text-xs");
    expect(tileLabelSizeClass("iOS")).toBe("text-[0.625rem]");
  });
});
