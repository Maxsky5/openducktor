import type { CSSProperties } from "react";
import {
  graphemesOf,
  tileForegroundColor,
} from "@openducktor/frontend-core/workspaces/workspace-tile-appearance";

/**
 * Keeps a 3 character abbreviation inside the tile without a cut. The count is in graphemes,
 * because a decomposed accent takes two UTF-16 units but only one tile column.
 */
export const tileLabelSizeClass = (label: string): string =>
  graphemesOf(label).length >= 3 ? "text-[0.625rem]" : "text-xs";

/** The opaque color face, with a label color picked by contrast. Carries no active marker. */
export const tileColorFaceStyle = (hex: string): CSSProperties => ({
  backgroundColor: hex,
  color: tileForegroundColor(hex),
});

const NO_COLOR_TILE_CLASSES = {
  active: "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent",
  inactive: "bg-workspace-rail-tile hover:bg-workspace-rail-tile",
} satisfies Record<"active" | "inactive", string>;

/**
 * Theme classes for a tile whose workspace has no picked color. The sidebar accent marks the
 * selected tile, as it marks the active navigation item, so the violet of the brand mark next to
 * it stays unique. The card surface keeps every other tile neutral.
 */
export const noColorTileClasses = (isActive: boolean): string =>
  NO_COLOR_TILE_CLASSES[isActive ? "active" : "inactive"];
