// The Close task confirmation of CloseTaskDialog.tsx: it opens over the window with the loader of
// its reads. Then its content shows at once, and the dialog takes the size of the content, as
// observeDialogResize of dialog-resize.ts resizes it. The close runs from its confirm button.
import { must } from "../../motion/dom";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";
import { modal } from "../studio/modal";

/** Seconds of a resize of the dialog: --resize-dur of dialog.css. */
const RESIZE = 0.3;

/** The dialog in the window `root`. */
export function closeTaskDialog(scene: Scene, root: HTMLElement) {
  const overlay = must(root, "[data-close-dialog]");
  const { box, open, close } = modal(scene, root, overlay);
  const confirm = must(box, "[data-confirm]");

  /** Build time: the dialog is closed, and it reads the task when it opens. */
  const reset = (): void => {
    overlay.hidden = true;
    box.toggleAttribute("data-loading", true);
    box.removeAttribute("data-closing");
  };

  /**
   * Opens the dialog at `at`. The loader shows while the dialog reads the task for `seconds`. Then
   * the content takes the place of the loader, and the dialog goes from the height of the loader to
   * the height of the content. Returns the time when the content shows.
   */
  const openAndRead = (at: number, seconds: number): number => {
    open(at);
    const read = at + seconds;
    scene.at(read, () => {
      const from = box.offsetHeight;
      box.removeAttribute("data-loading");
      scene.run(
        gsap.fromTo(
          box,
          { height: from },
          { height: box.offsetHeight, duration: RESIZE, ease: EASE.resize, clearProps: "height" },
        ),
      );
    });
    return read;
  };

  /** The close runs from `at`: the confirm button spins, and the dialog is disabled. */
  const submit = (at: number): void =>
    scene.at(at, () => box.toggleAttribute("data-closing", true));

  return { confirm: (): HTMLElement => confirm, reset, open: openAndRead, submit, close };
}
