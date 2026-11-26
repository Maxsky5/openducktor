// The steps of the Processes view: the badge of the rail button, the flyout, the stop of a
// command, and the floating window, which the visitor resizes and moves with the pointer.
// ProcessesSurfaces.tsx draws the surfaces, and Rail.tsx draws the button. Each surface opens and
// closes with the popover motion of popover.css, and the window fades in with floating-window.css.
import { all, must } from "../../motion/dom";
import { designPixel, shrinkOut } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import { offsetIn } from "../../motion/offset";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";
import type { Pointer } from "../shell/cursor";
import { popoverIn, popoverOut } from "../ui/popover";
import { FLOATING_MIN_SIZE } from "./model";

/** --presence-exit-dur of .process-presence in processes.css: a checkout folds away. */
const FOLD = 0.22;
/** sideOffset of the stop confirmation, beside its button. */
const CONFIRM_OFFSET = 8;

/** A size of the floating window, in CSS pixels of the replica. */
type WindowSize = { width: number; height: number };

/** The Processes view of the replica `root`, with `cursor`, the pointer of the replica. */
export function processesView(scene: Scene, root: HTMLElement, cursor: Pointer) {
  const button = must(root, "[data-processes]");
  const badge = must(button, "[data-processes-badge]");
  const flyout = must(root, "[data-processes-flyout]");
  const floating = must(root, "[data-processes-window]");
  const confirm = must(flyout, "[data-stop-confirm]");
  const line = (command: string): HTMLElement =>
    must(flyout, `[data-process-command="${command}"] [data-process-line]`);

  /** Build time: no command runs yet, and the view is closed. */
  const reset = (): void => {
    button.removeAttribute("data-open");
    badge.hidden = true;
    flyout.hidden = true;
    floating.hidden = true;
    confirm.hidden = true;
  };

  /** A read finds `count` running commands: the badge of the button pops in with the count. */
  const count = (value: number, at: number): void =>
    scene.at(at, () => {
      badge.textContent = String(value);
      badge.hidden = false;
      // .process-badge-enter of processes.css: 200 ms from scale 0.6.
      scene.run(
        gsap.fromTo(
          badge,
          { autoAlpha: 0, scale: 0.6 },
          {
            autoAlpha: 1,
            scale: 1,
            duration: 0.2,
            ease: EASE.chat,
            clearProps: "opacity,visibility,transform",
          },
        ),
      );
    });

  /** The flyout opens beside the rail. It shows the count, so the badge waits until it closes. */
  const open = (at: number): void =>
    scene.at(at, () => {
      button.toggleAttribute("data-open", true);
      badge.hidden = true;
      scene.run(popoverIn(flyout));
    });

  /** The Stop button of a command. */
  const stopOf = (command: string): HTMLElement => must(line(command), "[data-stop]");
  /** The Stop button of the confirmation. */
  const confirmButton = (): HTMLElement => must(confirm, "[data-stop-confirm-button]");

  /** Stop asks for confirmation beside its button, in the middle of its height. */
  const ask = (command: string, at: number): void =>
    scene.at(at, () => {
      const stop = stopOf(command);
      line(command).toggleAttribute("data-confirming", true);
      confirm.hidden = false;
      const place = offsetIn(stop, flyout);
      gsap.set(confirm, {
        left: place.x - CONFIRM_OFFSET * designPixel(root) - confirm.offsetWidth,
        top: place.y + (stop.offsetHeight - confirm.offsetHeight) / 2,
      });
      scene.run(popoverIn(confirm));
    });

  /** The visitor confirms: the confirmation closes, and the command shows Stopping…. */
  const stop = (command: string, at: number): void =>
    scene.at(at, () => {
      const row = line(command);
      scene.run(popoverOut(confirm));
      row.removeAttribute("data-confirming");
      row.toggleAttribute("data-stopping", true);
    });

  /**
   * The next read has no command in the checkout `group`. The counts change, and the checkout
   * folds away, as a CSS presence item collapses its height and fades.
   */
  const fold = (group: string, summary: string, at: number): void =>
    scene.at(at, () => {
      const section = must(flyout, `[data-process-group="${group}"]`);
      must(flyout, "[data-processes-summary]").textContent = summary;
      scene.run(shrinkOut(section, FOLD, EASE.chat));
    });

  /** The smallest size of the floating window, in CSS pixels of the replica. */
  const minimum = (): WindowSize => {
    const u = designPixel(root);
    return { width: FLOATING_MIN_SIZE.width * u, height: FLOATING_MIN_SIZE.height * u };
  };

  /**
   * Detach: the flyout closes, and the floating window opens where it was, at least at its
   * minimum size. The static frame gives the window its last place and size, so it starts moved
   * onto the box of the flyout with the size of the flyout.
   */
  const detach = (at: number): void =>
    scene.at(at, () => {
      floating.hidden = false;
      const least = minimum();
      gsap.set(floating, {
        width: Math.max(flyout.offsetWidth, least.width),
        height: Math.max(flyout.offsetHeight, least.height),
      });
      const from = offsetIn(flyout, root);
      const to = offsetIn(floating, root);
      scene.run(popoverOut(flyout));
      // floating-window-in of floating-window.css: 180 ms from scale 0.98.
      scene.run(
        gsap.fromTo(
          floating,
          { x: from.x - to.x, y: from.y - to.y, autoAlpha: 0, scale: 0.98 },
          { autoAlpha: 1, scale: 1, duration: 0.18, ease: EASE.chat },
        ),
      );
    });

  /**
   * The visitor drags the resize grip from `at` for `duration` until the window has its minimum
   * size. Returns the time of the release.
   */
  const resize = (at: number, duration: number): number =>
    cursor.drag(at, duration, () => {
      const from = { width: floating.offsetWidth, height: floating.offsetHeight };
      const least = minimum();
      const grip = cursor.tip();
      const setWidth = gsap.quickSetter(floating, "width", "px");
      const setHeight = gsap.quickSetter(floating, "height", "px");
      return {
        to: { x: grip.x + least.width - from.width, y: grip.y + least.height - from.height },
        onMove: (progress) => {
          setWidth(gsap.utils.interpolate(from.width, least.width, progress));
          setHeight(gsap.utils.interpolate(from.height, least.height, progress));
        },
        // The static frame gives the window its minimum size.
        onRelease: () => gsap.set(floating, { clearProps: "width,height" }),
      };
    });

  /**
   * The visitor moves the window by its title bar from `at` for `duration` to its place in the
   * static frame. Returns the time of the release.
   */
  const drag = (at: number, duration: number): number =>
    cursor.drag(at, duration, () => {
      const from = {
        x: Number(gsap.getProperty(floating, "x")),
        y: Number(gsap.getProperty(floating, "y")),
      };
      const grip = cursor.tip();
      const setX = gsap.quickSetter(floating, "x", "px");
      const setY = gsap.quickSetter(floating, "y", "px");
      return {
        to: { x: grip.x - from.x, y: grip.y - from.y },
        onMove: (progress) => {
          setX(from.x * (1 - progress));
          setY(from.y * (1 - progress));
        },
      };
    });

  /**
   * Shows or hides the This task badge of the window: only the session page of a task has a task
   * that the list shows first.
   */
  const setFocused = (focused: boolean): void => {
    for (const badge of all(floating, "[data-focus-badge]")) badge.hidden = !focused;
  };

  return {
    button,
    reset,
    count,
    open,
    stopOf,
    confirmButton,
    ask,
    stop,
    fold,
    detach,
    detachButton: (): HTMLElement => must(flyout, "[data-detach]"),
    titleBar: (): HTMLElement => must(floating, "[data-window-title]"),
    grip: (): HTMLElement => must(floating, "[data-window-grip]"),
    resize,
    drag,
    setFocused,
  };
}
