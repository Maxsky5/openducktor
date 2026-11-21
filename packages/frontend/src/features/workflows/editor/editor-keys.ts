import { elementKey } from "@openducktor/workflows";
import { useEffect } from "react";
import { hasOpenDialog } from "@/components/ui/open-dialogs";
import { isDeletable } from "./model/document-edits";
import type { EditorStore } from "./model/editor-store";

/** A text field keeps its own keys, such as undo and Backspace. */
const isTextTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

type EditorKey = Pick<KeyboardEvent, "key" | "target" | "preventDefault">;

/** A dialog, popover, or menu is open, and Escape closes it first. */
const hasOpenLayer = (): boolean =>
  hasOpenDialog() ||
  // A toast and a tooltip also mark themselves, but they hold no work, so the keys pass.
  document.querySelector(
    '[data-page-occluder]:not([data-sonner-toast]):not([data-slot="tooltip-content"])',
  ) !== null;

/** The heading of the details when the key comes from a control inside the details. */
const detailsHeadingOf = (target: EventTarget | null): HTMLElement | null =>
  target instanceof HTMLElement && target.closest("[data-inspector-fields]")
    ? (target.ownerDocument.querySelector<HTMLElement>("[data-inspector-heading]") ?? null)
    : null;

/**
 * Escape closes the details of the selection while no text field, menu, or dialog takes the key.
 * On a control inside the details, such as a picker that just closed, Escape first moves the
 * focus to the details heading, so the details close only on a second Escape.
 */
export const clearSelectionOnKey = (event: EditorKey, store: EditorStore): void => {
  if (event.key !== "Escape" || isTextTarget(event.target) || hasOpenLayer()) return;
  if (store.getState().selection === null) return;
  event.preventDefault();
  const heading = detailsHeadingOf(event.target);
  if (heading) heading.focus({ preventScroll: true });
  else store.getState().select(null);
};

/**
 * Delete and Backspace anywhere in the editor, such as on the row of the selection or in its
 * details, ask to delete the selected element, as its Delete button does. A text field keeps
 * these keys.
 */
export const deleteSelectedOnKey = (event: EditorKey, store: EditorStore): void => {
  if (event.key !== "Delete" && event.key !== "Backspace") return;
  if (isTextTarget(event.target) || hasOpenLayer()) return;
  if (!(event.target instanceof HTMLElement) || !event.target.closest(".workflow-editor")) return;
  const { readOnly, selection } = store.getState();
  if (readOnly || selection === null || !isDeletable(selection.key)) return;
  event.preventDefault();
  store.getState().requestRemove(selection.key);
};

/** Undo, redo, Escape, and Delete while no text field has the focus. */
export const useEditorKeys = (store: EditorStore): void => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // A focused button's tooltip takes Escape first. The details still close on that Escape.
      const tooltipTookEscape =
        event.key === "Escape" && document.querySelector('[data-slot="tooltip-content"]') !== null;
      if (event.defaultPrevented && !tooltipTookEscape) return;
      clearSelectionOnKey(event, store);
      deleteSelectedOnKey(event, store);
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      if (isTextTarget(event.target) || hasOpenLayer()) return;
      event.preventDefault();
      if (event.shiftKey) store.getState().redo();
      else store.getState().undo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [store]);
};

/** The element that a key on the canvas acts on: the focused state box, or the line label. */
const canvasTarget = (target: EventTarget | null, store: EditorStore) => {
  if (!(target instanceof HTMLElement)) return null;
  const stateId = target.closest<HTMLElement>(".react-flow__node")?.dataset.id;
  if (stateId) return elementKey("state", stateId);
  // A line label acts on its selected transition, or on its only transition.
  const ids = target.closest<HTMLElement>("[data-event-ids]")?.dataset.eventIds?.split(" ") ?? [];
  const keys = ids.map((id) => elementKey("event", id));
  const selection = store.getState().selection?.key;
  if (selection && keys.includes(selection)) return selection;
  return keys.length === 1 ? keys[0]! : null;
};

/**
 * Delete and Backspace on a focused state box or line label ask to delete that state or
 * transition, as the Delete button of the details does. A key on any other control, such as a canvas button,
 * deletes nothing.
 */
export const deleteSelectionOnKey = (event: EditorKey, store: EditorStore): void => {
  if (event.key !== "Delete" && event.key !== "Backspace") return;
  if (isTextTarget(event.target)) return;
  if (store.getState().readOnly) return;
  const key = canvasTarget(event.target, store);
  if (key === null || !isDeletable(key)) return;
  event.preventDefault();
  store.getState().requestRemove(key);
};
