export type VirtualWindowRange = {
  startIndex: number;
  endIndex: number;
};

type FindVirtualWindowRangeArgs = {
  itemOffsets: number[];
  itemHeights: number[];
  totalHeight: number;
  viewportStart: number;
  viewportEnd: number;
};

type VirtualWindowEdgeOffsetsArgs = {
  range: VirtualWindowRange;
  itemOffsets: number[];
  itemHeights: number[];
  totalHeight: number;
};

const EMPTY_RANGE: VirtualWindowRange = { startIndex: 0, endIndex: -1 };

export function buildVirtualColumnLayout(
  itemHeights: number[],
  gapPx: number,
): { itemOffsets: number[]; totalHeight: number } {
  const safeGapPx = Math.max(0, gapPx);
  const itemOffsets = new Array<number>(itemHeights.length);
  let nextOffset = 0;

  for (let index = 0; index < itemHeights.length; index += 1) {
    itemOffsets[index] = nextOffset;
    const safeHeight = Math.max(0, itemHeights[index] ?? 0);
    nextOffset += safeHeight;
    if (index < itemHeights.length - 1) {
      nextOffset += safeGapPx;
    }
  }

  return { itemOffsets, totalHeight: nextOffset };
}

export function findVirtualWindowRange({
  itemOffsets,
  itemHeights,
  totalHeight,
  viewportStart,
  viewportEnd,
}: FindVirtualWindowRangeArgs): VirtualWindowRange {
  if (itemHeights.length === 0) {
    return EMPTY_RANGE;
  }

  const minViewport = Math.min(viewportStart, viewportEnd);
  const maxViewport = Math.max(viewportStart, viewportEnd);

  if (maxViewport < 0 || minViewport > totalHeight) {
    return EMPTY_RANGE;
  }

  const start = Math.max(0, minViewport);
  const end = Math.max(0, maxViewport);
  const firstIndex = findFirstIndexWithEndAfterStart(itemOffsets, itemHeights, start);
  const lastIndex = findLastIndexWithStartBeforeEnd(itemOffsets, end);

  if (firstIndex < 0 || lastIndex < firstIndex) {
    return EMPTY_RANGE;
  }

  return { startIndex: firstIndex, endIndex: lastIndex };
}

export function getVirtualWindowEdgeOffsets({
  range,
  itemOffsets,
  itemHeights,
  totalHeight,
}: VirtualWindowEdgeOffsetsArgs): { topSpacerHeight: number; bottomSpacerHeight: number } {
  if (range.endIndex < range.startIndex || itemHeights.length === 0) {
    return { topSpacerHeight: 0, bottomSpacerHeight: totalHeight };
  }

  const topSpacerHeight = itemOffsets[range.startIndex] ?? 0;
  const visibleWindowEnd =
    (itemOffsets[range.endIndex] ?? 0) + (itemHeights[range.endIndex] ?? 0);
  const bottomSpacerHeight = Math.max(0, totalHeight - visibleWindowEnd);

  return { topSpacerHeight, bottomSpacerHeight };
}

function findFirstIndexWithEndAfterStart(
  itemOffsets: number[],
  itemHeights: number[],
  start: number,
): number {
  let low = 0;
  let high = itemOffsets.length - 1;
  let candidate = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const itemEnd = (itemOffsets[mid] ?? 0) + (itemHeights[mid] ?? 0);
    if (itemEnd >= start) {
      candidate = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return candidate;
}

function findLastIndexWithStartBeforeEnd(itemOffsets: number[], end: number): number {
  let low = 0;
  let high = itemOffsets.length - 1;
  let candidate = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const itemStart = itemOffsets[mid] ?? 0;
    if (itemStart <= end) {
      candidate = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return candidate;
}
