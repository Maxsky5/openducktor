import { KANBAN_CARD_CONTENT_WIDTH_PX, KANBAN_LABEL_ROW_GAP_PX } from "./kanban-layout";

const LABEL_CHIP_ICON_AND_GAP_PX = 18;
const LABEL_CHIP_HORIZONTAL_PADDING_PX = 20;
const LABEL_CHIP_BORDER_PX = 2;
const LABEL_CHIP_BASE_WIDTH_PX =
  LABEL_CHIP_ICON_AND_GAP_PX + LABEL_CHIP_HORIZONTAL_PADDING_PX + LABEL_CHIP_BORDER_PX;
const OVERFLOW_CHIP_HORIZONTAL_PADDING_PX = 20;
const OVERFLOW_CHIP_BORDER_PX = 2;
const OVERFLOW_CHIP_BASE_WIDTH_PX = OVERFLOW_CHIP_HORIZONTAL_PADDING_PX + OVERFLOW_CHIP_BORDER_PX;
const LABEL_TEXT_FONT =
  '500 11px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const OVERFLOW_TEXT_FONT =
  '600 11px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

type ResolveTaskLabelOverflowOptions = {
  availableWidthPx?: number;
  gapPx?: number;
  measureLabelWidth?: (label: string) => number;
  measureOverflowWidth?: (hiddenCount: number) => number;
};

type TaskLabelOverflowResult = {
  visibleLabels: string[];
  hiddenLabels: string[];
};

let measureCanvasContext: CanvasRenderingContext2D | null | undefined;
const measuredTextWidthCache = new Map<string, number>();

const getMeasureCanvasContext = (): CanvasRenderingContext2D | null => {
  if (typeof document === "undefined") {
    return null;
  }

  if (measureCanvasContext !== undefined) {
    return measureCanvasContext;
  }

  measureCanvasContext = document.createElement("canvas").getContext("2d");
  return measureCanvasContext;
};

const measureTextWidth = ({ text, font }: { text: string; font: string }): number => {
  const cacheKey = `${font}:${text}`;
  const cachedWidth = measuredTextWidthCache.get(cacheKey);
  if (typeof cachedWidth === "number") {
    return cachedWidth;
  }

  const context = getMeasureCanvasContext();
  const measuredWidth = context
    ? (() => {
        context.font = font;
        return context.measureText(text).width;
      })()
    : text.length * 6.2;
  const width = Math.ceil(measuredWidth);
  measuredTextWidthCache.set(cacheKey, width);
  return width;
};

const defaultMeasureLabelWidth = (label: string): number =>
  LABEL_CHIP_BASE_WIDTH_PX + measureTextWidth({ text: label, font: LABEL_TEXT_FONT });

const defaultMeasureOverflowWidth = (hiddenCount: number): number =>
  OVERFLOW_CHIP_BASE_WIDTH_PX +
  measureTextWidth({ text: `+${hiddenCount}`, font: OVERFLOW_TEXT_FONT });

export const resolveTaskLabelOverflow = (
  labels: string[],
  {
    availableWidthPx = KANBAN_CARD_CONTENT_WIDTH_PX,
    gapPx = KANBAN_LABEL_ROW_GAP_PX,
    measureLabelWidth = defaultMeasureLabelWidth,
    measureOverflowWidth = defaultMeasureOverflowWidth,
  }: ResolveTaskLabelOverflowOptions = {},
): TaskLabelOverflowResult => {
  let visibleCount = labels.length;
  let usedWidth = 0;

  for (let index = 0; index < labels.length; index += 1) {
    const label = labels[index] ?? "";
    const labelWidth = measureLabelWidth(label);
    const nextWidth = usedWidth + (index > 0 ? gapPx : 0) + labelWidth;
    const hiddenCount = labels.length - (index + 1);
    const reservedOverflowWidth = hiddenCount > 0 ? gapPx + measureOverflowWidth(hiddenCount) : 0;

    if (nextWidth + reservedOverflowWidth <= availableWidthPx) {
      usedWidth = nextWidth;
      continue;
    }

    visibleCount = index;
    break;
  }

  return {
    visibleLabels: labels.slice(0, visibleCount),
    hiddenLabels: labels.slice(visibleCount),
  };
};
