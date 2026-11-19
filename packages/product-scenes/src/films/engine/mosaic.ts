// The mosaic of a film: the sets leave their places in the world for rows of one wall, at the same
// height in each row, as a justified gallery. Each set scales around its top left corner, so its
// product view fills its tile. The opening of a film can start on the wall and send each set back
// to its place, and the closing can form the wall again.
import { gsap } from "../../motion/gsap";
import type { Box, Camera } from "./camera";
import type { Film } from "./film";

/** One tile of the mosaic: a set and the product view in it that the tile shows. */
type MosaicTile = { set: () => HTMLElement; view: () => HTMLElement };

export type MosaicOptions = {
  /** The rows of tiles, from the top. */
  rows: readonly (readonly MosaicTile[])[];
  /** The width of each row and the center of the wall, in world pixels. */
  width: number;
  center: { x: number; y: number };
  /** The space between two tiles, in world pixels. */
  gap: number;
};

/**
 * The place of a set in the wall: its move and its scale from its place in the grid, and the boxes
 * of the set and of its view in the grid, as the layout measured them.
 */
type Place = { set: HTMLElement; x: number; y: number; scale: number; origin: Box; view: Box };

/** The box of the wall and the place of each set in it, in the order of the rows. */
export type MosaicLayout = { wall: Box; places: Place[] };

/** The box of each view of a row at the same height, so that the row fills `width`. */
function rowBoxes(views: readonly Box[], width: number, gap: number): Box[] {
  const ratio = views.reduce((sum, view) => sum + view.width / view.height, 0);
  const height = (width - gap * (views.length - 1)) / ratio;
  let x = 0;
  return views.map((view) => {
    const box = { x, y: 0, width: (view.width / view.height) * height, height };
    x += box.width + gap;
    return box;
  });
}

/**
 * Measures the view of each tile in the layout of the page and lays out the wall. The camera
 * measures the boxes with the GSAP moves of the sets, so lay out the wall while each set is in its
 * place in the grid.
 */
export function layoutMosaic(
  camera: Camera,
  { rows, width, center, gap }: MosaicOptions,
): MosaicLayout {
  const measured = rows.map((row) =>
    row.map((tile) => ({ set: tile.set(), view: camera.boxOf(tile.view()) })),
  );
  const laid = measured.map((row) =>
    rowBoxes(
      row.map(({ view }) => view),
      width,
      gap,
    ),
  );
  const height =
    laid.reduce((sum, row) => sum + (row[0]?.height ?? 0), 0) + gap * (laid.length - 1);
  const top = center.y - height / 2;
  const places: Place[] = [];
  let y = top;
  measured.forEach((row, rowIndex) => {
    const boxes = laid[rowIndex] ?? [];
    row.forEach(({ set, view }, index) => {
      const box = boxes[index];
      if (!box) return;
      const scale = box.width / view.width;
      const origin = camera.boxOf(set);
      places.push({
        set,
        x: center.x - width / 2 + box.x - origin.x - (view.x - origin.x) * scale,
        y: y - origin.y - (view.y - origin.y) * scale,
        scale,
        origin,
        view,
      });
    });
    y += (boxes[0]?.height ?? 0) + gap;
  });
  return { wall: { x: center.x - width / 2, y: top, width, height }, places };
}

/** Puts each set in its place of the wall at once, for the first frame of a film. */
export function formMosaic({ places }: MosaicLayout): void {
  for (const { set, x, y, scale } of places) {
    gsap.set(set, { x, y, scale, transformOrigin: "0 0" });
  }
}

/**
 * Sends each set from the wall back to its place in the grid from `at`, with `ease`. The set
 * `first` leaves at `at`, as a camera move with the same ease can follow it, and the others follow
 * it one after the other.
 */
export function breakMosaic(
  timeline: gsap.core.Timeline,
  { places }: MosaicLayout,
  first: HTMLElement,
  at: number,
  duration: number,
  ease: string,
): void {
  const others = places.map(({ set }) => set).filter((set) => set !== first);
  timeline.to([first, ...others], { x: 0, y: 0, scale: 1, duration, ease, stagger: 0.025 }, at);
}

/**
 * Puts each set in its place of the wall at once at `at`. The film lays out the wall at that time,
 * because the scenes end in other layouts than their first frame. Returns the box of the wall,
 * which the camera can frame from `at` on.
 */
export function snapMosaic(film: Film, at: number, options: MosaicOptions): () => Box {
  let wall: Box | undefined;
  film.timeline.call(
    () => {
      const layout = layoutMosaic(film.camera, options);
      formMosaic(layout);
      wall = layout.wall;
    },
    [],
    at,
  );
  return () => {
    if (!wall) throw new Error("The camera frames the wall before it forms.");
    return wall;
  };
}
