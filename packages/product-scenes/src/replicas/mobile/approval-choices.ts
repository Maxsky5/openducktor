// The choices of ApproveSheet.tsx. A choice moves the thumb of the segmented control, selects the
// option card, and shows the parts of the chosen mode and merge method. The body of a sheet
// scrolls as far as a part must move to show in full, as the form of action-form.tsx scrolls
// above its footer.
import { all, must } from "../../motion/dom";
import { designPixel } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";
import { APPROVAL_MODES, type ApprovalMode, MERGE_METHODS, type MergeMethod } from "./ApproveSheet";

/** Seconds of a scroll of the form. */
const SCROLL = 0.6;

/** The room under a revealed element, in dp. */
const SCROLL_MARGIN = 16;

/** The approval step in `root`. */
export function approvalChoices(scene: Scene, root: HTMLElement) {
  const sheet = must(root, '[data-screen="approve"]');
  const segments = must(sheet, '[data-segments="approval"]');

  /** Shows the mode and the merge method at once. */
  const show = (mode: ApprovalMode, method: MergeMethod): void => {
    const index = APPROVAL_MODES.findIndex((option) => option.value === mode);
    segments.style.setProperty("--segment-index", `${index}`);
    for (const segment of all(segments, "[data-segment]"))
      segment.toggleAttribute("data-selected", segment.dataset.segment === mode);
    for (const option of MERGE_METHODS)
      must(sheet, `[data-option="${option.value}"]`).toggleAttribute(
        "data-selected",
        option.value === method,
      );
    for (const part of all(sheet, "[data-for-mode]")) {
      const forMethod = part.dataset.forMethod;
      part.hidden =
        part.dataset.forMode !== mode || (forMethod !== undefined && forMethod !== method);
    }
  };

  /** Chooses the mode and the merge method at `at`. */
  const choose = (mode: ApprovalMode, method: MergeMethod, at: number): void =>
    scene.at(at, () => show(mode, method));

  /**
   * Scrolls the body of the sheet `form` at `at` until the element of `find` shows in full above
   * the footer, as far as it must. A form that shows it already stays. Returns the end of the
   * scroll.
   */
  const reveal = (find: () => HTMLElement, at: number, form = sheet): number => {
    scene.at(at, () => {
      const content = must(form, "[data-sheet-body]");
      const view = content.parentElement;
      if (!view) throw new Error("The sheet body has no scroll view.");
      // The rectangles include the scale of the stage, and the offsets do not.
      const scale = view.getBoundingClientRect().height / view.offsetHeight;
      const below = find().getBoundingClientRect().bottom - view.getBoundingClientRect().bottom;
      const distance = below / scale + SCROLL_MARGIN * designPixel(form);
      if (distance <= 0) return;
      const y = Number(gsap.getProperty(content, "y")) - distance;
      scene.run(gsap.to(content, { y, duration: SCROLL, ease: EASE.move }));
    });
    return at + SCROLL;
  };

  return { sheet, show, choose, reveal };
}
