import {
  sanitizePairingCode,
  selectionAfterEdit,
  selectionForSlot,
  type CodeSelection,
} from "@openducktor/frontend-core/lib/pairing-code-selection";

/** The code and the slot selection after an edit of the hidden code field. */
export type CodeEdit = { code: string; selection: CodeSelection };

/**
 * The selection after the selected digit was replaced: the next digit, also when the new digit is
 * the same, so a correction reads on.
 */
export const selectionAfterReplace = (selection: CodeSelection, code: string): CodeSelection =>
  selectionForSlot(selection.end, code);

/**
 * The edit after a field without a selection range changed its text to `text`. The field holds the
 * whole code and keeps its caret at the end of `selection`. `inserted` is the text that the field
 * reported it inserted for this change, or null. Text inserted at the caret replaces the selected
 * digits. Any other change, such as an autofill that replaces the whole field, keeps the new text.
 */
export const editAtCaret = (
  value: string,
  selection: CodeSelection,
  text: string,
  inserted: string | null,
): CodeEdit => {
  const after = value.slice(selection.end);
  if (inserted === null || text !== value.slice(0, selection.end) + inserted + after) {
    const code = sanitizePairingCode(text);
    return { code, selection: selectionAfterEdit(value, code) };
  }
  const code = sanitizePairingCode(value.slice(0, selection.start) + inserted + after);
  const replaced = selection.start < selection.end && code.length === value.length;
  return {
    code,
    selection: replaced ? selectionAfterReplace(selection, code) : selectionAfterEdit(value, code),
  };
};
