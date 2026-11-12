// The open and the close of a dialog over a window, as dialog.css of packages/frontend does: the
// overlay fades in, and the box comes in from 0.96 of its size. The close takes the box back to
// that size and fades the overlay out. The start dialogs, the session dialogs, the import dialog,
// and the conflict dialog use it.
import { must } from "../../motion/dom";
import { fadeHide } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";

/** Seconds of the open and the close: --modal-open-dur and --modal-close-dur of dialog.css. */
const DURATION = { open: 0.25, close: 0.15 } as const;
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

  return { box, open, close };
}
