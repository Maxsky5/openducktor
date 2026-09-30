import { data, must } from "./dom";
import { showFrame, takeFrame } from "./frame";
import { gsap } from "./gsap";
import { checkLength, createPlayback, watchPlayback, whileMotionAllowed } from "./player";
import { createScene, type SceneBuilder } from "./scene";

/** Seconds that a loop takes to cross fade from its last frame into its first frame. */
const LOOP_FADE = 0.8;

/**
 * Plays a view in a loop while it is on screen. The stage markup is the static frame that
 * visitors without JavaScript or with reduced motion keep, most often the last frame of the loop.
 * The opening view holds its first frame, so the page does not change under the first paint, and
 * a view can hold a frame from the middle of its loop when that frame shows more. Each loop starts
 * from the markup with a new timeline, so no DOM change leaks from one loop to the next. The last
 * frame of a loop cross fades into the first frame of the next loop, so the window never goes
 * blank.
 */
export function mountLoop<Template extends string>(
  frame: HTMLElement,
  build: SceneBuilder<Template>,
): void {
  const stage = must(frame, "[data-stage]");
  const name = data(frame, "scene");
  const markup = stage.innerHTML;
  whileMotionAllowed(() => {
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
    const stopWatch = watchPlayback(frame, playback.sync);
    start();
    return () => {
      stopWatch();
      playback.stop();
      stage.innerHTML = markup;
    };
  });
}
