import { findHttpUrls } from "./terminal-url-policy";

/** A 1-based terminal buffer cell. xterm uses the same coordinates. */
export type TerminalCellPosition = { x: number; y: number };
export type TerminalCellRange = { start: TerminalCellPosition; end: TerminalCellPosition };

export type TerminalLinkTarget = {
  range: TerminalCellRange;
  source: "osc" | "plain";
  url: string;
};

type TerminalBufferCell = {
  getChars(): string;
  getCode(): number;
  getWidth(): number;
};

type TerminalBufferLine = {
  readonly isWrapped: boolean;
  readonly length: number;
  getCell(column: number): TerminalBufferCell | undefined;
};

/** The buffer fields that link reading uses. An xterm `Terminal` has them. */
export type TerminalLinkBuffer = {
  readonly cols: number;
  readonly buffer: {
    readonly active: {
      readonly length: number;
      getLine(row: number): TerminalBufferLine | undefined;
    };
  };
};

type LogicalCell = {
  end: number;
  range: TerminalCellRange;
  start: number;
};

type LogicalLine = {
  cells: LogicalCell[];
  firstRow: number;
  lastRow: number;
  text: string;
};

type LineLinks = {
  firstRow: number;
  lastRow: number;
  targets: TerminalLinkTarget[];
};

export type TerminalLinkReader = {
  clear(): void;
  /** The plain HTTP links that cross the 1-based buffer row. */
  linksAtRow(row: number): TerminalLinkTarget[];
  findLinkAt(position: TerminalCellPosition): TerminalLinkTarget | null;
  isCurrent(target: TerminalLinkTarget): boolean;
};

/**
 * Finds plain HTTP links in terminal output. A link can continue over soft-wrapped rows. The
 * reader keeps the links of the last logical line until `clear`.
 */
export const createTerminalLinkReader = (terminal: TerminalLinkBuffer): TerminalLinkReader => {
  let lastRead: LineLinks | null = null;
  const readRow = (row: number): TerminalLinkTarget[] => {
    if (lastRead && lastRead.firstRow <= row && row <= lastRead.lastRow) {
      return lastRead.targets;
    }
    lastRead = readLinks(terminal, row);
    return lastRead.targets;
  };
  return {
    clear: () => {
      lastRead = null;
    },
    linksAtRow: (row) =>
      readRow(row).filter(({ range }) => range.start.y <= row && row <= range.end.y),
    findLinkAt: (position) =>
      readRow(position.y).find((target) => rangeHasCell(target.range, position, terminal.cols)) ??
      null,
    isCurrent: (target) => readRow(target.range.start.y).some((link) => sameLink(link, target)),
  };
};

export const sameLink = (left: TerminalLinkTarget, right: TerminalLinkTarget): boolean =>
  left.url === right.url &&
  left.source === right.source &&
  samePosition(left.range.start, right.range.start) &&
  samePosition(left.range.end, right.range.end);

export const rangeHasCell = (
  range: TerminalCellRange,
  position: TerminalCellPosition,
  cols: number,
): boolean => {
  const lower = range.start.y * cols + range.start.x;
  const upper = range.end.y * cols + range.end.x;
  const current = position.y * cols + position.x;
  return lower <= current && current <= upper;
};

function samePosition(left: TerminalCellPosition, right: TerminalCellPosition): boolean {
  return left.x === right.x && left.y === right.y;
}

function readLogicalLine(terminal: TerminalLinkBuffer, row: number): LogicalLine {
  const buffer = terminal.buffer.active;
  let firstRow = row - 1;
  while (firstRow > 0 && buffer.getLine(firstRow)?.isWrapped) firstRow -= 1;

  let lastRow = row - 1;
  while (lastRow + 1 < buffer.length && buffer.getLine(lastRow + 1)?.isWrapped) lastRow += 1;

  let text = "";
  const cells: LogicalCell[] = [];
  for (let bufferRow = firstRow; bufferRow <= lastRow; bufferRow += 1) {
    const line = buffer.getLine(bufferRow);
    if (!line) continue;
    const cellCount = Math.min(line.length, terminal.cols);
    for (let column = 0; column < cellCount; column += 1) {
      const cell = line.getCell(column);
      if (!cell || cell.getWidth() === 0) continue;

      const softWrapPad =
        bufferRow < lastRow &&
        column === cellCount - 1 &&
        cell.getChars().length === 0 &&
        cell.getCode() === 0;
      if (softWrapPad) continue;

      const chars = cell.getChars() || " ";
      const start = text.length;
      text += chars;
      cells.push({
        start,
        end: text.length,
        range: {
          start: { x: column + 1, y: bufferRow + 1 },
          end: { x: column + cell.getWidth(), y: bufferRow + 1 },
        },
      });
    }
  }
  return { cells, firstRow: firstRow + 1, lastRow: lastRow + 1, text };
}

function findCellRange(
  cells: readonly LogicalCell[],
  start: number,
  end: number,
): TerminalCellRange | null {
  const first = cells.find((cell) => cell.end > start);
  const last = cells.findLast((cell) => cell.start < end);
  if (!first || !last) return null;
  return { start: first.range.start, end: last.range.end };
}

function readLinks(terminal: TerminalLinkBuffer, row: number): LineLinks {
  if (row < 1 || row > terminal.buffer.active.length) {
    return { firstRow: row, lastRow: row, targets: [] };
  }
  const line = readLogicalLine(terminal, row);
  const targets = findHttpUrls(line.text).flatMap((match) => {
    const range = findCellRange(line.cells, match.start, match.end);
    return range ? [{ range, source: "plain" as const, url: match.url }] : [];
  });
  return { firstRow: line.firstRow, lastRow: line.lastRow, targets };
}
