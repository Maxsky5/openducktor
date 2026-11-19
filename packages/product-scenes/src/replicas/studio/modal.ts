// The open and the close of a dialog over a window, as dialog.css of packages/frontend does: the
// overlay fades in, and the box comes in from 0.96 of its size. The close takes the box back to
// that size and fades the overlay out. A change of its content resizes the box. The start dialogs,
// the session dialogs, the import dialog, the conflict dialog, and the Close task dialog use it.
import { must } from "../../motion/dom";
import { fadeHide } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";

/**
 * Seconds of the open, the close, and a resize: --modal-open-dur, --modal-close-dur, and
 * --resize-dur of dialog.css.
 */
const DURATION = { open: 0.25, close: 0.15, resize: 0.3 } as const;
/** --modal-scale of dialog.css. */
const SCALE = 0.96;

type ModalOptions = {
  /**
   * The overlay is a template: the open appends it to `root`, and the close removes it. Without
   * it, the overlay is in the window, and the close hides it.
   */
  attach?: boolean;
};

/**
 * The dialog `overlay` over the window `root`, with its `[data-dialog-box]`. The overlay is the
 * parent of the box, so the open fades the shade and the blur of the overlay, not its opacity. The
 * box then gets its full opacity as fast as in the product, and the window does not show through
 * it.
 */
export function modal(
  scene: Scene,
  root: HTMLElement,
  overlay: HTMLElement,
  { attach = false }: ModalOptions = {},
) {
  const box = must(overlay, "[data-dialog-box]");

  /** Opens the dialog at `at`. */
  const open = (at: number): void =>
    scene.at(at, () => {
      if (attach) root.append(overlay);
      overlay.hidden = false;
      const shade = getComputedStyle(overlay);
      scene.run(
        gsap.fromTo(
          overlay,
          { backgroundColor: "rgba(0, 0, 0, 0)", backdropFilter: "blur(0px)" },
          {
            backgroundColor: shade.backgroundColor,
            backdropFilter: shade.backdropFilter,
            duration: DURATION.open,
            ease: EASE.arrive,
            clearProps: "backgroundColor,backdropFilter",
          },
        ),
      );
      scene.run(
        gsap.fromTo(
          box,
          { autoAlpha: 0, scale: SCALE },
          {
            autoAlpha: 1,
            scale: 1,
            duration: DURATION.open,
            ease: EASE.arrive,
            clearProps: "opacity,visibility,transform",
          },
        ),
      );
    });

  /** Closes the dialog at `at`. */
  const close = (at: number): void =>
    scene.at(at, () => {
      scene.run(gsap.to(box, { scale: SCALE, duration: DURATION.close, ease: EASE.arrive }));
      scene.run(
        attach
          ? gsap.to(overlay, {
              autoAlpha: 0,
              duration: DURATION.close,
              ease: EASE.arrive,
              onComplete: () => overlay.remove(),
            })
          : fadeHide(overlay, DURATION.close, EASE.arrive),
      );
    });

  /**
   * Removes the dialog at `at` with no close motion, as when React unmounts the dialog with its
   * parent: the close animation of dialog.css needs a dialog that stays mounted.
   */
  const unmount = (at: number): void =>
    scene.at(at, () => {
      if (attach) overlay.remove();
      else overlay.hidden = true;
    });

  /**
   * Runs `change` at `at`, and the box goes from its old size to the size of its new content, as
   * observeDialogResize of dialog-resize.ts resizes it.
   */
  const resize = (at: number, change: () => void): void =>
    scene.at(at, () => {
      const from = { width: box.offsetWidth, height: box.offsetHeight };
      change();
      const to = { width: box.offsetWidth, height: box.offsetHeight };
      if (from.width === to.width && from.height === to.height) return;
      scene.run(
        gsap.fromTo(box, from, {
          ...to,
          duration: DURATION.resize,
          ease: EASE.resize,
          clearProps: "width,height",
        }),
      );
    });

  return { box, open, close, unmount, resize };
}
