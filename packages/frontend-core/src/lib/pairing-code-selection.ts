import { remotePairingCodeSchema } from "@openducktor/contracts";

/** The selection of the hidden code field: a caret, or one selected digit. */
export type CodeSelection = { start: number; end: number };

export const CODE_LENGTH = 6;
/** The slot positions, as stable keys for the digit tiles. */
export const CODE_SLOTS = [0, 1, 2, 3, 4, 5] as const;

/** True for a complete six-digit pairing code. */
export const isPairingCode = (value: string): boolean =>
  remotePairingCodeSchema.safeParse(value).success;

/** Keeps the digits of typed or pasted text, up to the code length. */
export const sanitizePairingCode = (text: string): string =>
  text.replace(/\D/g, "").slice(0, CODE_LENGTH);

/**
 * True when typing completed the code. A changed digit of a full code does not count, so a
 * correction can finish before the form submits.
 */
export const completesPairingCode = (previous: string, next: string): boolean =>
  isPairingCode(next) && previous.length < next.length;

/** True when the slot at `position` shows the caret or holds a selected digit. */
export const slotIsActive = (selection: CodeSelection, position: number): boolean =>
  selection.start === selection.end
    ? position === Math.min(selection.start, CODE_LENGTH - 1)
    : position >= selection.start && position < selection.end;

/** The selection after an edit. A replaced digit selects the next one, so a correction reads on. */
export const selectionAfterEdit = (previous: string, next: string): CodeSelection => {
  if (next.length !== previous.length) return { start: next.length, end: next.length };
  let changed = 0;
  while (changed < next.length && next[changed] === previous[changed]) changed += 1;
  const position = Math.min(changed + 1, CODE_LENGTH);
  return { start: position, end: position < next.length ? position + 1 : position };
};

/**
 * The selection for a tap at `x`. `slotEnds` holds the right edge of each slot. A tap on a digit
 * selects it; a tap after the last digit puts the caret at the end of the code.
 */
export const selectionForTap = (
  slotEnds: readonly number[],
  x: number,
  value: string,
): CodeSelection => {
  const tapped = slotEnds.findIndex((end) => x < end);
  const position = Math.min(tapped === -1 ? CODE_LENGTH - 1 : tapped, value.length);
  return { start: position, end: position < value.length ? position + 1 : position };
};
