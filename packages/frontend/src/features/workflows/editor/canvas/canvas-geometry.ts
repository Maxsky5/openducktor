export type Point = { readonly x: number; readonly y: number };
export type Box = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** Whether two boxes share an area. */
export const boxesOverlap = (left: Box, right: Box): boolean =>
  left.x < right.x + right.width &&
  right.x < left.x + left.width &&
  left.y < right.y + right.height &&
  right.y < left.y + left.height;

/** The box around all boxes. */
export const unionBox = (boxes: readonly Box[]): Box => {
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const width = Math.max(...boxes.map((box) => box.x + box.width)) - x;
  const height = Math.max(...boxes.map((box) => box.y + box.height)) - y;
  return { x, y, width, height };
};
