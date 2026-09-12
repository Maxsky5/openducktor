import type {
  IBufferCellPosition,
  IBufferRange,
  ILink,
  ILinkProvider,
  Terminal,
} from "@xterm/xterm";
import { findHttpUrls } from "./terminal-url-policy";

export type LinkTarget = {
  range: IBufferRange;
  source: "osc" | "plain";
  url: string;
};

type LogicalCell = {
  end: number;
  range: IBufferRange;
  start: number;
};

type LogicalLine = {
  cells: LogicalCell[];
  text: string;
};

type LinkCallbacks = {
  hover(event: MouseEvent, target: LinkTarget): void;
  leave(event: MouseEvent, target: LinkTarget): void;
};

export type HttpLinkProvider = ILinkProvider & {
  findLinkAt(position: IBufferCellPosition): LinkTarget | null;
  isCurrent(target: LinkTarget): boolean;
};

export const createHttpLinkProvider = (
  terminal: Pick<Terminal, "buffer" | "cols">,
  callbacks: LinkCallbacks,
): HttpLinkProvider => {
  const readRow = (row: number): LinkTarget[] => readLinks(terminal, row);

  return {
    provideLinks: (row, callback) => {
      const targets = readRow(row).filter(
        ({ range }) => range.start.y <= row && row <= range.end.y,
      );
      const links: ILink[] = targets.map((target) => ({
        text: target.url,
        range: target.range,
        decorations: { pointerCursor: false, underline: true },
        activate: () => {
          // The capture handler opens links.
        },
        hover: (event) => callbacks.hover(event, target),
        leave: (event) => callbacks.leave(event, target),
      }));
      callback(links.length > 0 ? links : undefined);
    },
    findLinkAt: (position) =>
      readRow(position.y).find((target) => rangeHasCell(target.range, position, terminal.cols)) ??
      null,
    isCurrent: (target) => readRow(target.range.start.y).some((link) => sameLink(link, target)),
  };
};

export const sameLink = (left: LinkTarget, right: LinkTarget): boolean =>
  left.url === right.url &&
  left.source === right.source &&
  samePosition(left.range.start, right.range.start) &&
  samePosition(left.range.end, right.range.end);

export const rangeHasCell = (
  range: IBufferRange,
  position: IBufferCellPosition,
  cols: number,
): boolean => {
  const lower = range.start.y * cols + range.start.x;
  const upper = range.end.y * cols + range.end.x;
  const current = position.y * cols + position.x;
  return lower <= current && current <= upper;
};

function samePosition(left: IBufferCellPosition, right: IBufferCellPosition): boolean {
  return left.x === right.x && left.y === right.y;
}

function readLogicalLine(terminal: Pick<Terminal, "buffer" | "cols">, row: number): LogicalLine {
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
  return { cells, text };
}

function findCellRange(
  cells: readonly LogicalCell[],
  start: number,
  end: number,
): IBufferRange | null {
  const first = cells.find((cell) => cell.end > start);
  const last = cells.findLast((cell) => cell.start < end);
  if (!first || !last) return null;
  return { start: first.range.start, end: last.range.end };
}

function readLinks(terminal: Pick<Terminal, "buffer" | "cols">, row: number): LinkTarget[] {
  if (row < 1 || row > terminal.buffer.active.length) return [];
  const line = readLogicalLine(terminal, row);
  return findHttpUrls(line.text).flatMap((match) => {
    const range = findCellRange(line.cells, match.start, match.end);
    return range ? [{ range, source: "plain" as const, url: match.url }] : [];
  });
}
