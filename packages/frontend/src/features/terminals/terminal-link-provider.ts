import type {
  IBufferCellPosition,
  IBufferRange,
  ILink,
  ILinkProvider,
  Terminal,
} from "@xterm/xterm";
import { findTerminalHttpUrls } from "./terminal-url-policy";

export type TerminalLinkTarget = {
  range: IBufferRange;
  source: "osc" | "plain";
  url: string;
};

type LogicalCell = {
  endOffset: number;
  range: IBufferRange;
  startOffset: number;
};

type LogicalLine = {
  cells: LogicalCell[];
  text: string;
};

type TerminalLinkCallbacks = {
  activate(event: MouseEvent, target: TerminalLinkTarget): void;
  hover(event: MouseEvent, target: TerminalLinkTarget): void;
  leave(event: MouseEvent, target: TerminalLinkTarget): void;
};

const samePosition = (left: IBufferCellPosition, right: IBufferCellPosition): boolean =>
  left.x === right.x && left.y === right.y;

export const sameTerminalLinkTarget = (
  left: TerminalLinkTarget,
  right: TerminalLinkTarget,
): boolean =>
  left.url === right.url &&
  left.source === right.source &&
  samePosition(left.range.start, right.range.start) &&
  samePosition(left.range.end, right.range.end);

export const terminalRangeContains = (
  range: IBufferRange,
  position: IBufferCellPosition,
  columns: number,
): boolean => {
  const lower = range.start.y * columns + range.start.x;
  const upper = range.end.y * columns + range.end.x;
  const current = position.y * columns + position.x;
  return lower <= current && current <= upper;
};

const readLogicalLine = (terminal: Pick<Terminal, "buffer" | "cols">, row: number): LogicalLine => {
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

      const isSoftWrapPadding =
        bufferRow < lastRow &&
        column === cellCount - 1 &&
        cell.getChars().length === 0 &&
        cell.getCode() === 0;
      if (isSoftWrapPadding) continue;

      const value = cell.getChars() || " ";
      const startOffset = text.length;
      text += value;
      cells.push({
        startOffset,
        endOffset: text.length,
        range: {
          start: { x: column + 1, y: bufferRow + 1 },
          end: { x: column + cell.getWidth(), y: bufferRow + 1 },
        },
      });
    }
  }
  return { cells, text };
};

const findCellRange = (
  cells: readonly LogicalCell[],
  startOffset: number,
  endOffset: number,
): IBufferRange | null => {
  const first = cells.find((cell) => cell.endOffset > startOffset);
  const last = cells.findLast((cell) => cell.startOffset < endOffset);
  if (!first || !last) return null;
  return { start: first.range.start, end: last.range.end };
};

export const readTerminalLinksForBufferLine = (
  terminal: Pick<Terminal, "buffer" | "cols">,
  row: number,
): TerminalLinkTarget[] => {
  if (row < 1 || row > terminal.buffer.active.length) return [];
  const logicalLine = readLogicalLine(terminal, row);
  return findTerminalHttpUrls(logicalLine.text).flatMap((match) => {
    const range = findCellRange(logicalLine.cells, match.start, match.end);
    return range ? [{ range, source: "plain" as const, url: match.url }] : [];
  });
};

export type TerminalHttpLinkProvider = ILinkProvider & {
  findLinkAt(position: IBufferCellPosition): TerminalLinkTarget | null;
  isCurrent(target: TerminalLinkTarget): boolean;
};

export const createTerminalHttpLinkProvider = (
  terminal: Pick<Terminal, "buffer" | "cols">,
  callbacks: TerminalLinkCallbacks,
): TerminalHttpLinkProvider => {
  const linksForRow = (row: number): TerminalLinkTarget[] =>
    readTerminalLinksForBufferLine(terminal, row);

  return {
    provideLinks: (row, callback) => {
      const targets = linksForRow(row);
      const links: ILink[] = targets.map((target) => ({
        text: target.url,
        range: target.range,
        decorations: { pointerCursor: false, underline: true },
        activate: (event) => callbacks.activate(event, target),
        hover: (event) => callbacks.hover(event, target),
        leave: (event) => callbacks.leave(event, target),
      }));
      callback(links.length > 0 ? links : undefined);
    },
    findLinkAt: (position) =>
      linksForRow(position.y).find((target) =>
        terminalRangeContains(target.range, position, terminal.cols),
      ) ?? null,
    isCurrent: (target) =>
      linksForRow(target.range.start.y).some((current) => sameTerminalLinkTarget(current, target)),
  };
};
