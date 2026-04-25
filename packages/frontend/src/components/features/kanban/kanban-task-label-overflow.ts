import { KANBAN_CARD_CONTENT_WIDTH_PX, KANBAN_LABEL_ROW_GAP_PX } from "./kanban-layout";

const LABEL_CHIP_ICON_AND_GAP_PX = 18;
const LABEL_CHIP_HORIZONTAL_PADDING_PX = 20;
const LABEL_CHIP_BORDER_PX = 2;
const LABEL_CHIP_BASE_WIDTH_PX =
  LABEL_CHIP_ICON_AND_GAP_PX + LABEL_CHIP_HORIZONTAL_PADDING_PX + LABEL_CHIP_BORDER_PX;
const OVERFLOW_CHIP_HORIZONTAL_PADDING_PX = 20;
const OVERFLOW_CHIP_BORDER_PX = 2;
const OVERFLOW_CHIP_BASE_WIDTH_PX = OVERFLOW_CHIP_HORIZONTAL_PADDING_PX + OVERFLOW_CHIP_BORDER_PX;
const MEASURE_ROOT_STYLE =
  "position:absolute;left:-9999px;top:0;visibility:hidden;pointer-events:none;white-space:nowrap;";

// Keep these utility classes aligned with TaskLabelChip's text styles.
const LABEL_TEXT_CLASS = "text-[11px] font-medium whitespace-nowrap";
const OVERFLOW_TEXT_CLASS = "text-[11px] font-semibold whitespace-nowrap";

type ResolveTaskLabelOverflowOptions = {
  availableWidthPx?: number;
  gapPx?: number;
  measureLabelWidth?: (label: string) => number | null;
  measureOverflowWidth?: (hiddenCount: number) => number | null;
};

type TaskLabelOverflowResult = {
  visibleLabels: string[];
  hiddenLabels: string[];
};

type TextMeasureElements = {
  root: HTMLDivElement;
  label: HTMLSpanElement;
  overflow: HTMLSpanElement;
};

let textMeasureElements: TextMeasureElements | null | undefined;
const measuredTextWidthCache = new Map<string, number>();

const getTextMeasureElements = (): TextMeasureElements | null => {
  if (typeof document === "undefined") {
    return null;
  }

  if (textMeasureElements !== undefined) {
    return textMeasureElements;
  }

  const root = document.createElement("div");
  root.setAttribute("style", MEASURE_ROOT_STYLE);

  const label = document.createElement("span");
  label.className = LABEL_TEXT_CLASS;
  root.appendChild(label);

  const overflow = document.createElement("span");
  overflow.className = OVERFLOW_TEXT_CLASS;
  root.appendChild(overflow);

  (document.body ?? document.documentElement).appendChild(root);
  textMeasureElements = { root, label, overflow };
  return textMeasureElements;
};

const measureTextWidth = ({
  text,
  kind,
}: {
  text: string;
  kind: "label" | "overflow";
}): number | null => {
  const cacheKey = `${kind}:${text}`;
  const cachedWidth = measuredTextWidthCache.get(cacheKey);
  if (typeof cachedWidth === "number") {
    return cachedWidth;
  }

  const elements = getTextMeasureElements();
  if (!elements) {
    return null;
  }

  const target = kind === "label" ? elements.label : elements.overflow;
  target.textContent = text;
  const width = Math.ceil(target.getBoundingClientRect().width);
  measuredTextWidthCache.set(cacheKey, width);
  return width;
};

const defaultMeasureLabelWidth = (label: string): number | null => {
  const textWidth = measureTextWidth({ text: label, kind: "label" });
  return textWidth === null ? null : LABEL_CHIP_BASE_WIDTH_PX + textWidth;
};

const defaultMeasureOverflowWidth = (hiddenCount: number): number | null => {
  const textWidth = measureTextWidth({ text: `+${hiddenCount}`, kind: "overflow" });
  return textWidth === null ? null : OVERFLOW_CHIP_BASE_WIDTH_PX + textWidth;
};

export const resolveTaskLabelOverflow = (
  labels: string[],
  options: ResolveTaskLabelOverflowOptions = {},
): TaskLabelOverflowResult => {
  const {
    availableWidthPx = KANBAN_CARD_CONTENT_WIDTH_PX,
    gapPx = KANBAN_LABEL_ROW_GAP_PX,
    measureLabelWidth = defaultMeasureLabelWidth,
    measureOverflowWidth = defaultMeasureOverflowWidth,
  } = options;
  const hasCustomMeasurement =
    options.measureLabelWidth !== undefined || options.measureOverflowWidth !== undefined;

  if (typeof document === "undefined" && !hasCustomMeasurement) {
    return {
      visibleLabels: labels,
      hiddenLabels: [],
    };
  }

  let visibleCount = labels.length;
  let usedWidth = 0;

  for (let index = 0; index < labels.length; index += 1) {
    const label = labels[index] ?? "";
    const labelWidth = measureLabelWidth(label);
    if (labelWidth === null) {
      return {
        visibleLabels: labels,
        hiddenLabels: [],
      };
    }

    const nextWidth = usedWidth + (index > 0 ? gapPx : 0) + labelWidth;
    const hiddenCount = labels.length - (index + 1);
    const overflowWidth = hiddenCount > 0 ? measureOverflowWidth(hiddenCount) : 0;
    if (hiddenCount > 0 && overflowWidth === null) {
      return {
        visibleLabels: labels,
        hiddenLabels: [],
      };
    }

    const reservedOverflowWidth = hiddenCount > 0 ? gapPx + (overflowWidth ?? 0) : 0;

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
