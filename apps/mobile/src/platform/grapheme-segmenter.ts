/**
 * A grapheme-only `Intl.Segmenter` for runtimes without one. Hermes documents no `Intl.Segmenter`.
 * It keeps combining marks, variation selectors, emoji modifiers, tag sequences, zero width joiner
 * sequences, keycaps, regional indicator pairs, and CR LF in one segment, which covers the
 * initials and labels that shared code builds.
 */
type GraphemeSegment = { segment: string; index: number; input: string };
type GraphemeSegmenterOptions = { locale: string; granularity: "grapheme" };

const isExtender = (codePoint: number): boolean =>
  (codePoint >= 0x0300 && codePoint <= 0x036f) ||
  (codePoint >= 0x0483 && codePoint <= 0x0489) ||
  (codePoint >= 0x0591 && codePoint <= 0x05bd) ||
  (codePoint >= 0x0610 && codePoint <= 0x061a) ||
  (codePoint >= 0x064b && codePoint <= 0x065f) ||
  (codePoint >= 0x0900 && codePoint <= 0x0903) ||
  (codePoint >= 0x093a && codePoint <= 0x094f) ||
  (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
  (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
  (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
  (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
  (codePoint >= 0xfe20 && codePoint <= 0xfe2f) ||
  (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff) ||
  (codePoint >= 0xe0020 && codePoint <= 0xe007f) ||
  (codePoint >= 0xe0100 && codePoint <= 0xe01ef) ||
  codePoint === 0x200d;

const isRegionalIndicator = (codePoint: number): boolean =>
  codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff;

const ZERO_WIDTH_JOINER = 0x200d;

export const segmentGraphemes = (input: string): GraphemeSegment[] => {
  const segments: GraphemeSegment[] = [];
  let current = "";
  let start = 0;
  let index = 0;
  let previous = -1;
  let regionalRun = 0;
  for (const character of input) {
    const codePoint = character.codePointAt(0) ?? 0;
    const joins =
      current !== "" &&
      (isExtender(codePoint) ||
        previous === ZERO_WIDTH_JOINER ||
        (previous === 0x0d && codePoint === 0x0a) ||
        (isRegionalIndicator(codePoint) && regionalRun % 2 === 1));
    if (joins) {
      current += character;
    } else {
      if (current !== "") segments.push({ segment: current, index: start, input });
      current = character;
      start = index;
      regionalRun = 0;
    }
    regionalRun = isRegionalIndicator(codePoint) ? regionalRun + 1 : 0;
    previous = codePoint;
    index += character.length;
  }
  if (current !== "") segments.push({ segment: current, index: start, input });
  return segments;
};

export class GraphemeSegmenter {
  constructor(_locales?: string | string[], options?: { granularity?: string }) {
    if (options?.granularity !== undefined && options.granularity !== "grapheme") {
      throw new RangeError(
        `This device supports only grapheme segmentation, not ${options.granularity}.`,
      );
    }
  }

  segment(input: string): GraphemeSegment[] {
    return segmentGraphemes(input);
  }

  resolvedOptions(): GraphemeSegmenterOptions {
    return { locale: "en", granularity: "grapheme" };
  }
}
