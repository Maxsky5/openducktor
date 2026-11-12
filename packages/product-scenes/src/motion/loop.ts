import { data, must } from "./dom";
import { fadeThrough, showFrame, takeFrame } from "./frame";
import { gsap } from "./gsap";
import { checkLength, createPlayback } from "./playback";
import { createScene, type SceneBuilder } from "./scene";

/**
 * Seconds that the last frame of a loop takes to fade out to the background, and then the first
 * frame takes to fade in.
 */
const LOOP_FADE = 0.3;

/** A scene that plays in a loop. */
export type Loop = {
  /** Plays or pauses the current run, or its fade. */
  sync: (running: boolean) => void;
  /** Kills the run and puts back the static markup. */
  stop: () => void;
};

/**
 * Builds the loop of the view in `frame`. The stage markup is the static frame that visitors
 * without JavaScript or with reduced motion keep, most often the last frame of the loop. The
 * opening view holds its first frame, so the page does not change under the first paint, and a
 * view can hold a frame from the middle of its loop when that frame shows more. Each run starts
 * from the markup with a new timeline, so no DOM change leaks from one run to the next. The last
 * frame of a run fades out to the background, then the first frame of the next run fades in, so
 * two frames never show on top of each other. The loop starts paused.
 */
export function createLoop<Template extends string>(
  frame: HTMLElement,
  build: SceneBuilder<Template>,
): Loop {
  const stage = must(frame, "[data-stage]");
  const name = data(frame, "scene");
  const markup = stage.innerHTML;
  const playback = createPlayback((cover, done) => fadeThrough(cover, stage, LOOP_FADE, done));
  const start = (cover?: HTMLElement): void => {
    stage.innerHTML = markup;
    const timeline = gsap.timeline({ paused: true });
    build(createScene(frame, stage, timeline));
    const built = timeline.duration();
    timeline.eventCallback("onComplete", () => {
      checkLength(name, timeline, built);
      start(showFrame(takeFrame(stage), stage));
    });
    playback.start(timeline, cover);
  };
  start();
  return {
    sync: playback.sync,
    stop: () => {
      playback.stop();
      stage.innerHTML = markup;
    },
  };
}
