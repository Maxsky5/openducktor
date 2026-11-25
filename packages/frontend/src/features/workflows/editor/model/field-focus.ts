import type { WorkflowProblemPath } from "@openducktor/contracts";
import { formatProblemPath } from "@openducktor/workflows";

const FOCUSABLE = "input:not([type=hidden]), textarea, button, [tabindex]:not([tabindex='-1'])";

/**
 * The field of a problem path: the field with the longest matching path prefix. A problem about
 * a whole list or item finds the field of that list or item. A problem about the whole element
 * finds the field with the empty path, when the inspector has one.
 */
export const findField = (container: ParentNode, path: WorkflowProblemPath): HTMLElement | null => {
  const fields = new Map<string, HTMLElement>();
  for (const field of container.querySelectorAll<HTMLElement>("[data-field-path]")) {
    const attribute = field.getAttribute("data-field-path");
    if (attribute !== null && !fields.has(attribute)) fields.set(attribute, field);
  }
  for (let length = path.length; length >= 0; length -= 1) {
    const field = fields.get(formatProblemPath(path.slice(0, length)));
    if (field) return field;
  }
  return null;
};

/**
 * Focuses the control of a field and scrolls the field to the middle of the scroll container
 * only, so the page around the panel keeps its place. Returns whether a field matched.
 */
export const focusField = (scroller: HTMLElement, path: WorkflowProblemPath): boolean => {
  const field = findField(scroller, path);
  if (!field) return false;
  const control = field.matches(FOCUSABLE) ? field : field.querySelector<HTMLElement>(FOCUSABLE);
  const offset = field.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  scroller.scrollTop += offset - scroller.clientHeight / 2 + field.clientHeight / 2;
  control?.focus({ preventScroll: true });
  return true;
};
