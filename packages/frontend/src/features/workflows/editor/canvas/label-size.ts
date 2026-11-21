/** The label box of a line. `event-edge.tsx` draws labels with these sizes on one line. */
const LABEL_MIN_WIDTH = 64;
/** A longer label ends with an ellipsis, and its tooltip shows the whole text. */
export const LABEL_MAX_WIDTH = 260;
/** An entry label holds the source count too, and has the room at the left of its box. */
export const ENTRY_LABEL_MAX_WIDTH = 320;
const LABEL_HEIGHT = 26;
/** The average width of one character of the 13px label text. */
const CHARACTER_WIDTH = 7.6;
/** The padding, the icons, and the gaps of a label. */
const CHROME_WIDTH = 56;

export type LabelSize = { readonly width: number; readonly height: number };

/** The room of a problem mark at the end of a label, with its gap. */
const MARK_WIDTH = 20;

/**
 * The size of a label: its text on one line, and a problem mark when it has one, between the
 * minimum and maximum widths.
 */
export const labelSize = (text: string, maxWidth = LABEL_MAX_WIDTH, marked = false): LabelSize => ({
  width: Math.min(
    maxWidth,
    Math.max(
      LABEL_MIN_WIDTH,
      Math.round(text.length * CHARACTER_WIDTH + CHROME_WIDTH + (marked ? MARK_WIDTH : 0)),
    ),
  ),
  height: LABEL_HEIGHT,
});
