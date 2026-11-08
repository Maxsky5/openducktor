// The Fork session dialog of ForkDialog.tsx: it opens over a window, the visitor selects the work
// location, Fork session shows the startup progress, and the dialog closes when the fork is ready.
import { all, must } from "../../motion/dom";
import type { Scene } from "../../motion/scene";
import type { ForkLocation } from "./ForkDialog";
import { progressDialog } from "./progress-dialog";

/** The dialog in `root` and the steps that fill it. */
export function forkDialog(scene: Scene, root: HTMLElement) {
  const dialog = progressDialog(scene, root, must(root, "[data-fork-dialog]"));
  const { box } = dialog;
  const body = must(box, "[data-dialog-body]");
  const worktreeFields = must(body, "[data-worktree-fields]");
  const location = (value: ForkLocation): HTMLElement => must(body, `[data-location="${value}"]`);

  /** Selects the work location `value`. New worktree shows its fields. */
  const selectNow = (value: ForkLocation): void => {
    for (const option of all(body, "[data-location]"))
      option.toggleAttribute("data-selected", option === location(value));
    worktreeFields.hidden = value !== "new_worktree";
  };

  /** Build time: the closed dialog as it opens, with Same folder. */
  const reset = (): void => {
    dialog.reset();
    selectNow("same_folder");
  };

  return {
    location,
    worktree: (): HTMLElement => must(body, '[data-field="worktree"]'),
    confirm: (): HTMLElement => must(box, "[data-confirm]"),
    reset,
    open: dialog.open,
    close: dialog.close,
    select: (value: ForkLocation, at: number): void => scene.at(at, () => selectNow(value)),
    scrollToEnd: dialog.scrollToEnd,
    start: dialog.start,
    runSteps: dialog.runSteps,
  };
}
