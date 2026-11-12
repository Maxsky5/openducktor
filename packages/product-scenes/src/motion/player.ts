// The page players: when a view plays and when it pauses, from its part of the screen, the reduced
// motion setting, and the pause control of the page. The loop, chapter, and single-play players
// build on it.
import { gsap } from "./gsap";
import { createLoop } from "./loop";
import { isPausedByVisitor, MOTION_QUERY, onPauseChange } from "./preference";
import type { SceneBuilder } from "./scene";
import { motionState } from "./state";

/**
 * The part of the screen where a view plays. `top` and `bottom` are the percents of the screen
 * height, from its top edge and from its bottom edge, that do not count. A view plays while a
 * part of it shows between them.
 */
export type PlayZone = { top: number; bottom: number };

/**
 * A view plays while at least part of it shows: from the moment its top passes 88% of the screen
 * height until its bottom passes 12%.
 */
const PLAY_ZONE: PlayZone = { top: 12, bottom: 12 };

/** The root margin of an IntersectionObserver that sees only the play zone of the screen. */
function zoneMargin({ top, bottom }: PlayZone): string {
  return `${-top}% 0px ${-bottom}% 0px`;
}

/**
 * Runs `setup` while the visitor accepts motion. `setup` returns the function that undoes it: it
 * kills the animations of the setup and puts back the markup. Returns the function that undoes the
 * setup and stops to follow the motion setting, for a host that removes the view, such as React.
 */
export function whileMotionAllowed(setup: () => () => void): () => void {
  // One media context for each setup, so a host can stop one view. Its handler puts the markup
  // back when motion stops.
  const media = gsap.matchMedia();
  media.add(MOTION_QUERY, (context) => {
    // GSAP runs each callback of an animation in the context of that animation. Out of the media
    // context, each run of a loop and each step of a scene do not add their animations to it.
    let undo: (() => void) | undefined;
    context.ignore(() => {
      undo = setup();
    });
    return undo;
  });
  return () => media.revert();
}

/**
 * Follows whether a view plays: it is in its play zone and the visitor has not paused motion. The
 * root carries data-motion, which the CSS of the view also reads. The browser checks the zone
 * against the current layout, so a view keeps the correct state when the page above it changes
 * height. Returns the stop function.
 */
export function watchPlayback(
  root: HTMLElement,
  sync: (running: boolean) => void,
  zone: PlayZone = PLAY_ZONE,
): () => void {
  let visible = false;
  const update = (): void => {
    const running = visible && !isPausedByVisitor();
    root.dataset.motion = motionState(running);
    sync(running);
  };
  const unsubscribe = onPauseChange(update);
  const observer = new IntersectionObserver(
    (entries) => {
      const entry = entries.at(-1);
      if (!entry || entry.isIntersecting === visible) return;
      visible = entry.isIntersecting;
      update();
    },
    { rootMargin: zoneMargin(zone) },
  );
  observer.observe(root);
  update();
  return () => {
    unsubscribe();
    observer.disconnect();
    delete root.dataset.motion;
  };
}

/**
 * Plays the view in `frame` in a loop while it is in its part of the screen and the visitor allows
 * motion. A page that needs no handle uses it. A host that controls the scene uses `mountScene`.
 * Returns the function that stops the loop and puts back the static markup.
 */
export function mountLoop<Template extends string>(
  frame: HTMLElement,
  build: SceneBuilder<Template>,
): () => void {
  return whileMotionAllowed(() => {
    const loop = createLoop(frame, build);
    const stopWatch = watchPlayback(frame, loop.sync);
    return () => {
      stopWatch();
      loop.stop();
    };
  });
}
