// The New session dialog of SessionCreateDialog.tsx: it opens over a window, the visitor fills it,
// Create session shows the startup progress, and the dialog closes when the session is ready.
import { all, must } from "../../motion/dom";
import type { Scene } from "../../motion/scene";
import { typeText } from "../../motion/text";
import { progressDialog } from "./progress-dialog";
import type { WorkLocation } from "./WorkLocationField";
import type { WorktreeName } from "./WorktreeFields";

/** The text fields of the dialog. */
type Field = "name" | "worktree";

/** The dialog in `root` and the steps that fill it. */
export function sessionCreateDialog(scene: Scene, root: HTMLElement) {
  const overlay = must(root, "[data-session-dialog]");
  const dialog = progressDialog(scene, root, overlay);
  const { box } = dialog;
  const body = must(box, "[data-dialog-body]");
  const worktreeFields = must(body, "[data-worktree-fields]");
  const directory = must(worktreeFields, "[data-directory]");
  const branch = must(worktreeFields, "[data-new-branch]");
  const field = (name: Field): HTMLElement => must(body, `[data-field="${name}"]`);
  const typedIn = (name: Field): HTMLElement => must(field(name), "[data-typed]");
  const location = (value: WorkLocation): HTMLElement => must(body, `[data-location="${value}"]`);

  /** Shows the directory and the new branch of the worktree name `text`. */
  const showWorktree = (text: string, prefix: string): void => {
    directory.hidden = text === "";
    branch.hidden = text === "";
    must(directory, ".mono").textContent = text;
    must(branch, ".mono").textContent = `${prefix}/${text}`;
  };

  /** Selects the work location `value`. New worktree shows its fields. */
  const selectNow = (value: WorkLocation): void => {
    for (const option of all(body, "[data-location]"))
      option.toggleAttribute("data-selected", option === location(value));
    worktreeFields.hidden = value !== "local_worktree";
  };

  /** Build time: the closed dialog as it opens, with empty fields and Current checkout. */
  const reset = (): void => {
    dialog.reset();
    for (const name of ["name", "worktree"] as const) {
      field(name).removeAttribute("data-filled");
      typedIn(name).textContent = "";
    }
    showWorktree("", "");
    selectNow("local_repo_root");
  };

  /** Gives the field `name` the focus at `at`, and takes it away at `until`. */
  const focus = (name: Field, at: number, until: number): void => {
    scene.at(at, () => {
      field(name).toggleAttribute("data-focused", true);
      typedIn(name).toggleAttribute("data-typing", true);
    });
    scene.at(until, () => {
      field(name).removeAttribute("data-focused");
      typedIn(name).removeAttribute("data-typing");
    });
  };

  /** Types `text` in the field `name` from `at`. Returns the end time. */
  const type = (name: Field, text: string, at: number, onText?: (text: string) => void): number =>
    typeText(scene, typedIn(name), text, at, {
      charsPerSecond: 16,
      onText: (shown) => {
        field(name).toggleAttribute("data-filled", shown !== "");
        onText?.(shown);
      },
    });

  /** Types the worktree name, and shows its directory and its new branch with `prefix`. */
  const typeWorktree = (worktree: WorktreeName, prefix: string, at: number): number =>
    type("worktree", worktree.name, at, (shown) => showWorktree(shown, prefix));

  return {
    field,
    location,
    target: (): HTMLElement => must(body, "[data-target]"),
    create: (): HTMLElement => must(box, "[data-create]"),
    reset,
    open: dialog.open,
    close: dialog.close,
    focus,
    type,
    typeWorktree,
    select: (value: WorkLocation, at: number): void => scene.at(at, () => selectNow(value)),
    scrollToEnd: dialog.scrollToEnd,
    start: dialog.start,
    runSteps: dialog.runSteps,
  };
}
