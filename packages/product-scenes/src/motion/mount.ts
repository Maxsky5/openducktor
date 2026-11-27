// The mount of a scene with a handle: it builds the loop of the scene while the visitor accepts
// motion, and it gives its host the controls of the loop. The app tour and a frame renderer use
// it. A page that needs no handle uses `mountLoop`. This module watches no play zone, so the host
// decides when the scene plays.
import { gsap } from "./gsap";
import { createLoop, type Loop } from "./loop";
import { MOTION_QUERY } from "./preference";
import type { SceneBuilder } from "./scene";
import { motionState } from "./state";

/** Seconds of one rendered frame, when a renderer plays a scene or a film up to a time. */
const FRAME = 1 / 60;

/** Times closer than this are the same time: GSAP rounds the time of a timeline to 7 decimals. */
const SAME_TIME = 1e-6;

/**
 * Calls `show` with each frame time after `from`, up to `to`, so a renderer that moves forward runs
 * each change of a scene at its time: the steps of a scene measure the page when they run.
 */
export function stepForward(from: number, to: number, show: (time: number) => void): void {
  for (let at = from; to - at > SAME_TIME;) {
    at = Math.min(to, at + FRAME);
    show(at);
  }
}

/** The controls of a mounted scene. */
export type SceneHandle = {
  /** Lets the scene play. */
  play: () => void;
  /**
   * Pauses the scene and shows the frame at `time` seconds of the current run, for a frame
   * renderer. A time before the current time starts a new run from the static markup.
   */
  seek: (time: number) => void;
  /** The length of one run in seconds. */
  duration: () => number;
  /** Stops the scene, removes its timers and listeners, and puts back the static markup. */
  stop: () => void;
};

/**
 * Mounts the scene of the view in `root`, the element with `data-scene`, with `build`, the builder
 * of each run of the loop. The scene stays paused until `play()`. With reduced motion, the scene
 * does not build: the view keeps its static frame, and `seek` and `duration` fail. The root
 * carries `data-motion`, which the CSS of the scene reads to pause its CSS animations.
 */
export function mountScene<Template extends string>(
  root: HTMLElement,
  build: SceneBuilder<Template>,
): SceneHandle {
  const media = gsap.matchMedia();
  let playing = false;
  let loop: Loop | undefined;
  let timeline: gsap.core.Timeline | undefined;

  const startLoop = (): Loop =>
    createLoop<Template>(root, (scene) => {
      timeline = scene.timeline;
      build(scene);
    });
  const update = (): void => {
    root.dataset.motion = motionState(playing);
    loop?.sync(playing);
  };
  const current = (): gsap.core.Timeline => {
    if (!timeline)
      throw new Error("The scene has no timeline: the visitor asks for reduced motion.");
    return timeline;
  };

  media.add(MOTION_QUERY, (context) => {
    // GSAP runs each callback of an animation in the context of that animation. Out of the media
    // context, each run of the loop and each step of a scene do not add their animations to it.
    // The cleanup below kills them.
    context.ignore(() => {
      loop = startLoop();
      update();
    });
    return () => {
      loop?.stop();
      loop = undefined;
      timeline = undefined;
      delete root.dataset.motion;
    };
  });

  return {
    play: () => {
      playing = true;
      update();
    },
    seek: (time) => {
      const length = current().duration();
      if (!(time >= 0 && time < length))
        throw new Error(`Seek to a time from 0 to below ${length.toFixed(2)} s, not ${time} s.`);
      playing = false;
      update();
      if (time < current().time() - SAME_TIME) {
        loop?.stop();
        loop = startLoop();
      }
      const run = current();
      stepForward(run.time(), time, (at) => run.time(at));
    },
    duration: () => current().duration(),
    stop: () => media.revert(),
  };
}
