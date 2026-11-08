import { data, must } from "./dom";
import { showFrame, takeFrame } from "./frame";
import { gsap } from "./gsap";
import { checkLength, createPlayback } from "./playback";
import { createScene, type SceneBuilder } from "./scene";

/** Seconds that a loop takes to cross fade from its last frame into its first frame. */
const LOOP_FADE = 0.8;

/** A scene that plays in a loop. */
export type Loop = {
  /** Plays or pauses the current run, or its cross fade. */
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
 * frame of a run cross fades into the first frame of the next run, so the window never goes blank.
 * The loop starts paused.
 */
export function createLoop<Template extends string>(
  frame: HTMLElement,
  build: SceneBuilder<Template>,
): Loop {
  const stage = must(frame, "[data-stage]");
  const name = data(frame, "scene");
  const markup = stage.innerHTML;
  const playback = createPlayback(LOOP_FADE);
  const start = (cover?: HTMLElement): void => {
    stage.innerHTML = markup;
    const timeline = gsap.timeline({ paused: true });
    build(createScene(frame, stage, timeline));
    const built = timeline.duration();
    timeline.eventCallback("onComplete", () => {
      checkLength(name, timeline, built);
      // The cover takes the place and the size of the last frame, so the stage is measured
      // before the frame leaves it.
      const box = stage.getBoundingClientRect();
      start(showFrame(takeFrame(stage), stage, box));
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
