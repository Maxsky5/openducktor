// The page players: when a view plays and when it pauses, from its part of the screen, the reduced
// motion setting, and the pause control of the page. The loop, chapter, and single-play players
// build on it.
import { gsap } from "./gsap";
import { createLoop } from "./loop";
import { isPausedByVisitor, MOTION_QUERY, onPauseChange } from "./preference";
import type { SceneBuilder } from "./scene";
import { ScrollTrigger } from "./scroll";

/** The part of the scroll where a view plays, in the start and end terms of ScrollTrigger. */
export type PlayZone = { start: string; end: string };

/**
 * A view plays while at least part of it shows: from the moment its top passes 88% of the screen
 * height until its bottom passes 12%.
 */
export const PLAY_ZONE: PlayZone = { start: "top 88%", end: "bottom 12%" };

/** One media context for the page. Its handlers put the markup back when motion stops. */
const media = gsap.matchMedia();

/**
 * Runs `setup` while the visitor accepts motion. `setup` returns the function that undoes it: it
 * kills the animations of the setup and puts back the markup.
 */
export function whileMotionAllowed(setup: () => () => void): void {
  media.add(MOTION_QUERY, (context) => {
    // GSAP runs each callback of an animation in the context of that animation. Out of the media
    // context, each run of a loop and each step of a scene do not add their animations to it.
    let undo: (() => void) | undefined;
    context.ignore(() => {
      undo = setup();
    });
    return undo;
  });
}

/**
 * Follows whether a view plays: it is in its play zone and the visitor has not paused motion. The
 * root carries data-motion, which the CSS of the view also reads. Returns the stop function.
 */
export function watchPlayback(
  root: HTMLElement,
  sync: (running: boolean) => void,
  zone: PlayZone = PLAY_ZONE,
): () => void {
  let visible = false;
  const update = (): void => {
    const running = visible && !isPausedByVisitor();
    root.dataset.motion = running ? "running" : "paused";
    sync(running);
  };
  const unsubscribe = onPauseChange(update);
  const trigger = ScrollTrigger.create({
    trigger: root,
    ...zone,
    onToggle: (self) => {
      visible = self.isActive;
      update();
    },
  });
  update();
  return () => {
    unsubscribe();
    trigger.kill();
    delete root.dataset.motion;
  };
}

/**
 * Plays the view in `frame` in a loop while it is in its part of the screen and the visitor allows
 * motion. A page that needs no handle uses it. A host that controls the scene uses `mountScene`.
 */
export function mountLoop<Template extends string>(
  frame: HTMLElement,
  build: SceneBuilder<Template>,
): void {
  whileMotionAllowed(() => {
    const loop = createLoop(frame, build);
    const stopWatch = watchPlayback(frame, loop.sync);
    return () => {
      stopWatch();
      loop.stop();
    };
  });
}
