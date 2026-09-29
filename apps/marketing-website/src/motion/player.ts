// The player core that every view shares: when a view plays, when it pauses, and how a new frame
// takes over from the last one. The loop, chapter, and single-play players build on it.
import { fadeOut } from "./frame";
import { gsap, ScrollTrigger } from "./gsap";
import { isPausedByVisitor, MOTION_QUERY, onPauseChange } from "./preference";

/** The part of the scroll where a view plays, in the start and end terms of ScrollTrigger. */
export type PlayZone = { start: string; end: string };

/**
 * A view plays while at least part of it shows: from the moment its top passes 88% of the screen
 * height until its bottom passes 12%.
 */
const PLAY_ZONE: PlayZone = { start: "top 88%", end: "bottom 12%" };

/** One media context for the page. Its handlers put the markup back when motion stops. */
const media = gsap.matchMedia();

/** Runs `setup` while the visitor accepts motion. `setup` returns the function that undoes it. */
export function whileMotionAllowed(setup: () => () => void): void {
  media.add(MOTION_QUERY, setup);
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

/** The animation of a player: a cross fade from the last frame, then the timeline of the scene. */
export type Playback = {
  /** Plays `timeline` when the view runs, after `cover` fades out. */
  start: (timeline: gsap.core.Timeline, cover?: HTMLElement) => void;
  sync: (running: boolean) => void;
  stop: () => void;
};

export function createPlayback(fade: number): Playback {
  let running = false;
  let timeline: gsap.core.Timeline | undefined;
  let cover: HTMLElement | undefined;
  let fading: gsap.core.Tween | undefined;
  const clearFade = (): void => {
    fading?.kill();
    cover?.remove();
    fading = undefined;
    cover = undefined;
  };
  const sync = (value: boolean): void => {
    running = value;
    if (!running) {
      timeline?.pause();
      fading?.pause();
    } else if (fading) {
      // The next scene starts when its first frame shows in full.
      fading.play();
    } else {
      timeline?.play();
    }
  };
  return {
    start: (next, frame) => {
      timeline?.kill();
      clearFade();
      timeline = next;
      if (frame) {
        cover = frame;
        fading = fadeOut(frame, fade, () => {
          cover = undefined;
          fading = undefined;
          sync(running);
        });
      }
      sync(running);
    },
    sync,
    stop: () => {
      timeline?.kill();
      timeline = undefined;
      clearFade();
    },
  };
}

/**
 * Checks that a scene kept the length that it had when it was built. A step that adds a tween at
 * run time must end before the end hold of the scene, so the progress of a chapter tab and the
 * loop time stay true. The error does not stop the other views.
 */
export function checkLength(name: string, timeline: gsap.core.Timeline, built: number): void {
  if (timeline.duration() <= built + 0.001) return;
  const grown = timeline.duration().toFixed(2);
  queueMicrotask(() => {
    throw new Error(
      `The ${name} scene grew from ${built.toFixed(2)} s to ${grown} s while it played. Hold its last frame longer.`,
    );
  });
}
