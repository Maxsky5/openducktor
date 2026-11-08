// The session start dialog of StartDialog.tsx: it opens over a window, the visitor clicks one of
// its buttons, and it closes. The session page and the palette view start sessions with it.
import { must } from "../../motion/dom";
import type { Scene } from "../../motion/scene";
import type { Pointer } from "../shell/cursor";
import { modal } from "./modal";

/**
 * Opens the start dialog `overlay` over `root` at `at`, clicks Start session, or Run in background
 * when `button` is "background", and closes the dialog. Returns the close time.
 */
export function startDialog(
  scene: Scene,
  root: HTMLElement,
  cursor: Pointer,
  overlay: HTMLElement,
  at: number,
  button: "start" | "background" = "start",
): number {
  const dialog = modal(scene, root, overlay, { attach: true });
  dialog.open(at);
  const clicked = cursor.click(() => must(overlay, `[data-${button}]`), at + 1.1, 1);
  dialog.close(clicked + 0.25);
  return clicked + 0.5;
}
