import { type RefObject, useLayoutEffect, useRef } from "react";

/**
 * Keeps the focus in a list when a row goes or the add control goes. After a remove, the remove
 * button of the row that takes its place gets the focus, else the one of the row before, else the
 * add control. After the last option is added, the add control goes, so the remove button of the
 * new row gets the focus. Else the next Tab would start at the top of the app.
 *
 * Mark remove buttons with `data-remove-row` and the add control with `data-add-row`.
 */
export const useFocusAfterRemove = (
  list: RefObject<HTMLElement | null>,
  /** The remove buttons of this list only, when lists nest. */
  rows = "[data-remove-row]",
  /** The add control, when it sits outside the list. */
  addControl: (root: HTMLElement) => HTMLElement | null = (root) =>
    root.querySelector<HTMLElement>("[data-add-row]"),
) => {
  const pending = useRef<{ place: number } | "added" | null>(null);
  useLayoutEffect(() => {
    const change = pending.current;
    if (change === null) return;
    pending.current = null;
    const root = list.current;
    if (!root || root.contains(document.activeElement)) return;
    const buttons = [...root.querySelectorAll<HTMLElement>(rows)].filter(
      (button) => !button.hasAttribute("disabled"),
    );
    const next =
      change === "added" ? buttons.at(-1) : buttons[Math.min(change.place, buttons.length - 1)];
    (next ?? addControl(root))?.focus();
  });
  const markRemoved = (place: number) => {
    pending.current = { place };
  };
  const markAdded = () => {
    pending.current = "added";
  };
  return { markRemoved, markAdded };
};
