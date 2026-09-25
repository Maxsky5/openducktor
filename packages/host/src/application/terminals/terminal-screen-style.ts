import type { IBuffer, IBufferCell, Terminal } from "@xterm/headless";

export type XtermAttributes = {
  isFgRGB(): boolean;
  isFgPalette(): boolean;
  isBgRGB(): boolean;
  isBgPalette(): boolean;
  getFgColor(): number;
  getBgColor(): number;
  isBold(): number | boolean;
  isDim(): number | boolean;
  isItalic(): number | boolean;
  isUnderline(): number | boolean;
  getUnderlineStyle(): number;
  extended: { underlineColor: number };
  isBlink(): number | boolean;
  isInverse(): number | boolean;
  isInvisible(): number | boolean;
  isStrikethrough(): number | boolean;
  isOverline(): number | boolean;
};

const colorCodes = (attributes: XtermAttributes, foreground: boolean): number[] => {
  const color = foreground ? attributes.getFgColor() : attributes.getBgColor();
  const rgb = foreground ? attributes.isFgRGB() : attributes.isBgRGB();
  const palette = foreground ? attributes.isFgPalette() : attributes.isBgPalette();
  if (rgb) {
    return [foreground ? 38 : 48, 2, (color >>> 16) & 255, (color >>> 8) & 255, color & 255];
  }
  if (palette) {
    if (color >= 16) return [foreground ? 38 : 48, 5, color];
    const base = foreground ? (color & 8 ? 90 : 30) : color & 8 ? 100 : 40;
    return [base + (color & 7)];
  }
  return [];
};

export const styleSequence = (attributes: XtermAttributes): string => {
  const underlineStyle = attributes.getUnderlineStyle() || (attributes.isUnderline() ? 1 : 0);
  const underlineColor = attributes.extended.underlineColor;
  const underlineMode = underlineColor & 0x03000000;
  const codes = [
    ...colorCodes(attributes, true),
    ...colorCodes(attributes, false),
    ...(attributes.isBold() ? [1] : []),
    ...(attributes.isDim() ? [2] : []),
    ...(attributes.isItalic() ? [3] : []),
    ...(underlineStyle ? [underlineStyle === 1 ? 4 : `4:${underlineStyle}`] : []),
    ...(underlineMode === 0x03000000
      ? [58, 2, (underlineColor >>> 16) & 255, (underlineColor >>> 8) & 255, underlineColor & 255]
      : underlineMode === 0x01000000 || underlineMode === 0x02000000
        ? [58, 5, underlineColor & 255]
        : []),
    ...(attributes.isBlink() ? [5] : []),
    ...(attributes.isInverse() ? [7] : []),
    ...(attributes.isInvisible() ? [8] : []),
    ...(attributes.isStrikethrough() ? [9] : []),
    ...(attributes.isOverline() ? [53] : []),
  ];
  return codes.length > 0 ? `\u001b[${codes.join(";")}m` : "";
};

export const hasExtendedUnderline = (attributes: XtermAttributes): boolean =>
  attributes.getUnderlineStyle() > 1 || (attributes.extended.underlineColor & 0x03000000) !== 0;

export const underlineOverlay = (terminal: Terminal, buffer: IBuffer): string => {
  const parts: string[] = [];
  for (let row = 0; row < terminal.rows; row += 1) {
    const line = buffer.getLine(buffer.viewportY + row);
    if (!line) continue;
    let run = "";
    let runStyle = "";
    let runColumn = 0;
    let nextColumn = 0;
    const flush = () => {
      if (run) parts.push(`\u001b[${row + 1};${runColumn + 1}H\u001b[0m${runStyle}${run}`);
      run = "";
    };
    for (let column = 0; column < terminal.cols; column += 1) {
      const cell = line.getCell(column);
      if (!cell || cell.getWidth() === 0) {
        flush();
        continue;
      }
      // SAFETY: xterm 6.0.0 buffer cells inherit these attribute methods and extended data.
      const attributes = cell as IBufferCell & XtermAttributes;
      if (!hasExtendedUnderline(attributes)) {
        flush();
        continue;
      }
      const style = styleSequence(attributes);
      if (run && (style !== runStyle || column !== nextColumn)) flush();
      if (!run) {
        runColumn = column;
        runStyle = style;
      }
      run += cell.getChars() || " ";
      nextColumn = column + cell.getWidth();
    }
    flush();
  }
  return parts.length ? "\u001b(B\u000f\u001b[?6l" + parts.join("") : "";
};
