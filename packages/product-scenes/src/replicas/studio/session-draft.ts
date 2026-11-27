// The draft page of SessionDraft.tsx and the popovers of DraftPopovers.tsx: the visitor picks a
// work location in its menu and opens the branch popover, and the first message docks the
// composer at the bottom of the transcript, as useComposerDockGlide of
// workspace-session-draft-view.tsx glides it. The saved session then takes the place of the draft
// in the top bar, and its actions show when the session is ready.
import { all, must } from "../../motion/dom";
import { designPixel } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import { offsetIn } from "../../motion/offset";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";
import type { Pointer } from "../shell/cursor";
import { popoverIn, popoverOut } from "../ui/popover";
import type { WorkLocation } from "./SessionDraft";

/** The space between a trigger and its popover: sideOffset of PopoverContent. */
const SIDE_OFFSET = 6;
/** The space that a popover keeps from the edges of the window. */
const EDGE = 8;
/** The glide of the composer to its dock: 240 ms. */
const DOCK_GLIDE = 0.24;
/** session-header-reveal of inline-session-startup.css: 200 ms. */
const HEADER_REVEAL = 0.2;
/** session-smooth-reveal of inline-session-startup.css: 180 ms, from 4 pixels lower. */
const SENT_REVEAL = { duration: 0.18, rise: 4 } as const;

/** The popover templates of the options bar. */
type DraftPopovers = { menu: HTMLElement; branch: HTMLElement };

/** The draft page `page` in the window `root`, and the steps that move it. */
export function sessionDraft(
  scene: Scene,
  root: HTMLElement,
  page: HTMLElement,
  cursor: Pointer,
  popovers: DraftPopovers,
) {
  const location = must(page, "[data-location-trigger]");
  const branch = must(page, "[data-branch-trigger]");
  const dock = must(page, "[data-dock]");
  const typed = must(dock, "[data-typed]");
  const draftHeader = must(page, '[data-header="draft"]');
  const sessionHeader = must(page, '[data-header="session"]');
  const actions = must(sessionHeader, "[data-header-actions]");
  const draftTitle = must(draftHeader, "[data-draft-title]");
  const startingTitle = must(draftHeader, "[data-starting-title]");
  const discard = must(draftHeader, "[data-discard]");

  /** Shows `value` in the location trigger. New worktree shows the branch trigger. */
  const showLocation = (value: WorkLocation): void => {
    for (const choice of all(location, "[data-location-value]"))
      choice.hidden = choice.dataset.locationValue !== value;
    for (const part of all(page, "[data-branch-part]")) part.hidden = value !== "local_worktree";
  };

  /** Build time: the draft page with the location `value` and the draft top bar. */
  const reset = (value: WorkLocation): void => {
    page.toggleAttribute("data-draft", true);
    showLocation(value);
    draftHeader.hidden = false;
    sessionHeader.hidden = true;
    draftTitle.hidden = false;
    startingTitle.hidden = true;
    discard.hidden = false;
  };

  /**
   * Puts `popover` under `trigger`, aligned to its start and inside the window. When the window has
   * no room under the trigger, the popover goes above it, as a Radix popover avoids a collision.
   */
  const place = (popover: HTMLElement, trigger: HTMLElement): void => {
    root.append(popover);
    const unit = designPixel(root);
    const anchor = offsetIn(trigger, root);
    const right = root.clientWidth - popover.offsetWidth - EDGE * unit;
    const below = anchor.y + trigger.offsetHeight + SIDE_OFFSET * unit;
    const fits = below + popover.offsetHeight <= root.clientHeight - EDGE * unit;
    gsap.set(popover, {
      left: Math.max(EDGE * unit, Math.min(anchor.x, right)),
      top: fits ? below : anchor.y - SIDE_OFFSET * unit - popover.offsetHeight,
      transformOrigin: fits ? "top left" : "bottom left",
    });
  };

  /**
   * The visitor clicks `trigger` from `at`, and `popover` opens under it. The trigger shows its
   * hover just before the click. Returns the click.
   */
  const open = (popover: HTMLElement, trigger: HTMLElement, at: number): number => {
    const clicked = cursor.click(() => trigger, at, 0.8);
    scene.at(clicked - 0.15, () => trigger.toggleAttribute("data-hover", true));
    scene.at(clicked, () => {
      // The click moves the focus out of the composer, so its caret hides.
      typed.removeAttribute("data-typing");
      trigger.toggleAttribute("data-open", true);
      place(popover, trigger);
      scene.run(popoverIn(popover));
    });
    return clicked;
  };

  const close = (popover: HTMLElement, trigger: HTMLElement, at: number): void =>
    scene.at(at, () => {
      trigger.removeAttribute("data-open");
      scene.run(popoverOut(popover));
    });

  /**
   * The visitor opens the location menu from `at`, moves to `value`, which takes the highlight,
   * and picks it. The menu closes, and the trigger shows the location. Returns the pick time.
   */
  const pickLocation = (value: WorkLocation, at: number): number => {
    const { menu } = popovers;
    const opened = open(menu, location, at);
    const option = (): HTMLElement => must(menu, `[data-option="${value}"]`);
    scene.at(opened + 0.9, () => location.removeAttribute("data-hover"));
    const picked = cursor.click(option, opened + 0.9, 0.6);
    scene.at(picked - 0.25, () => {
      for (const item of all(menu, "[data-option]"))
        item.toggleAttribute("data-active", item === option());
    });
    close(menu, location, picked + 0.05);
    scene.at(picked + 0.05, () => showLocation(value));
    return picked;
  };

  /**
   * The first message goes at `at`: the transcript takes the place of the stage, and the composer
   * glides from the middle of the page to its dock. The top bar shows the message and no Discard.
   */
  const send = (at: number): void =>
    scene.at(at, () => {
      const before = offsetIn(dock, root).y;
      page.removeAttribute("data-draft");
      draftTitle.hidden = true;
      startingTitle.hidden = false;
      discard.hidden = true;
      scene.run(
        gsap.fromTo(
          dock,
          { y: before - offsetIn(dock, root).y },
          { y: 0, duration: DOCK_GLIDE, ease: EASE.glide, clearProps: "transform" },
        ),
      );
    });

  /**
   * The sent message `row` comes in at `at` as DraftSubmittedMessageBubble, which is pending until
   * the session is ready. Build time: the row hides and is pending.
   */
  const showSent = (row: HTMLElement, at: number): void => {
    row.hidden = true;
    row.toggleAttribute("data-pending", true);
    scene.at(at, () => {
      row.hidden = false;
      scene.run(
        gsap.fromTo(
          row,
          { autoAlpha: 0, y: SENT_REVEAL.rise * designPixel(root) },
          {
            autoAlpha: 1,
            y: 0,
            duration: SENT_REVEAL.duration,
            ease: EASE.glide,
            clearProps: "opacity,visibility,transform",
          },
        ),
      );
    });
  };

  /**
   * The host saves the session at `at`, and the session page takes the place of the draft: its
   * top bar shows the title of the session and hides its actions while the session starts.
   */
  const handOff = (at: number): void =>
    scene.at(at, () => {
      draftHeader.hidden = true;
      sessionHeader.hidden = false;
      gsap.set(actions, { autoAlpha: 0 });
    });

  /** The session is ready at `at`, and the actions of the top bar fade in. */
  const reveal = (at: number): void =>
    scene.at(at, () =>
      scene.run(
        gsap.to(actions, {
          autoAlpha: 1,
          duration: HEADER_REVEAL,
          ease: EASE.glide,
          clearProps: "opacity,visibility",
        }),
      ),
    );

  return {
    reset,
    pickLocation,
    openBranch: (at: number): number => open(popovers.branch, branch, at),
    /** The pointer leaves the branch trigger at `at`. */
    leaveBranch: (at: number): void => scene.at(at, () => branch.removeAttribute("data-hover")),
    branchName: (): HTMLElement => must(popovers.branch, "[data-branch-name]"),
    closeBranch: (at: number): void => close(popovers.branch, branch, at),
    send,
    showSent,
    handOff,
    reveal,
  };
}
