// The playback core that every player shares: how a new frame takes over from the last one, and
// the check of the length of a scene. It watches no play zone, so a host that controls its scenes
// can use it.

/**
 * How the last frame of a player gives way to the next frame: a paused animation of `cover`
 * that calls `done` at its end. A kill before the end leaves the next frame as it was.
 */
export type FrameFade = (cover: HTMLElement, done: () => void) => gsap.core.Animation;

/** The animation of a player: a fade from the last frame, then the timeline of the scene. */
export type Playback = {
  /** Plays `timeline` when the view runs, after `cover` fades out. */
  start: (timeline: gsap.core.Timeline, cover?: HTMLElement) => void;
  sync: (running: boolean) => void;
  stop: () => void;
};

export function createPlayback(fade: FrameFade): Playback {
  let running = false;
  let timeline: gsap.core.Timeline | undefined;
  let cover: HTMLElement | undefined;
  let fading: gsap.core.Animation | undefined;
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
        const done = (): void => {
          cover = undefined;
          fading = undefined;
          sync(running);
        };
        fading = fade(frame, done);
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
