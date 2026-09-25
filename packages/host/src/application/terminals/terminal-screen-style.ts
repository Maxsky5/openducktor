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
  extended: { underlineColor: number; urlId: number };
  isBlink(): number | boolean;
  isInverse(): number | boolean;
  isInvisible(): number | boolean;
  isStrikethrough(): number | boolean;
  isOverline(): number | boolean;
  isProtected(): number | boolean;
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
  const sgr = codes.length > 0 ? `\u001b[${codes.join(";")}m` : "";
  return attributes.isProtected() ? `${sgr}\u001b[1"q` : sgr;
};

export const needsCellRepair = (attributes: XtermAttributes): boolean =>
  !!attributes.isProtected() ||
  attributes.getUnderlineStyle() > 1 ||
  (attributes.extended.underlineColor & 0x03000000) !== 0 ||
  attributes.extended.urlId !== 0;

export const hyperlinkSequence = (terminal: Terminal, urlId: number): string => {
  if (!urlId) return "";
  // SAFETY: xterm 6.0.0 keeps OSC 8 destinations in this core service.
  const core = terminal as Terminal & {
    _core?: {
      _oscLinkService?: { getLinkData(id: number): { id?: string; uri: string } | undefined };
    };
  };
  const service = core._core?._oscLinkService;
  if (!service?.getLinkData)
    throw new Error("Terminal hyperlink state is unavailable. Restart OpenDucktor and try again.");
  const link = service.getLinkData(urlId);
  return link ? `\u001b]8;${link.id ? `id=${link.id}` : ""};${link.uri}\u001b\\` : "";
};

const CLOSE_HYPERLINK = "\u001b]8;;\u001b\\";

export const attributeOverlay = (terminal: Terminal, buffer: IBuffer): string => {
  const parts: string[] = [];
  for (let row = 0; row < terminal.rows; row += 1) {
    const line = buffer.getLine(buffer.viewportY + row);
    if (!line) continue;
    let run = "";
    let runStyle = "";
    let runLinkId = 0;
    let runColumn = 0;
    let nextColumn = 0;
    const flush = () => {
      if (run) {
        const link = hyperlinkSequence(terminal, runLinkId);
        parts.push(
          `\u001b[${row + 1};${runColumn + 1}H\u001b[0m${runStyle}${link}${run}${link ? CLOSE_HYPERLINK : ""}`,
        );
      }
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
      if (!needsCellRepair(attributes)) {
        flush();
        continue;
      }
      const style = styleSequence(attributes);
      const linkId = attributes.extended.urlId;
      if (run && (style !== runStyle || linkId !== runLinkId || column !== nextColumn)) flush();
      if (!run) {
        runColumn = column;
        runStyle = style;
        runLinkId = linkId;
      }
      run += cell.getChars() || " ";
      nextColumn = column + cell.getWidth();
    }
    flush();
  }
  return parts.length ? "\u001b(B\u000f\u001b[?6l" + parts.join("") : "";
};
