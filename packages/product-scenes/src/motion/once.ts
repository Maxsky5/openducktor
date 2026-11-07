import { must } from "./dom";
import { gsap } from "./gsap";
import { type PlayZone, watchPlayback, whileMotionAllowed } from "./player";
import { isPausedByVisitor } from "./preference";
import { createScene, type SceneBuilder } from "./scene";

/**
 * Plays a view once, the first time the visitor reaches it, then keeps its last frame. The pause
 * control shows the last frame at once, because the content of the view matters more than its
 * motion. The stage markup holds the last frame.
 */
export function mountOnce(frame: HTMLElement, build: SceneBuilder, zone?: PlayZone): void {
  const stage = must(frame, "[data-stage]");
  const markup = stage.innerHTML;
  whileMotionAllowed(() => {
    const timeline = gsap.timeline({ paused: true });
    build(createScene(frame, stage, timeline));
    const sync = (running: boolean): void => {
      if (isPausedByVisitor()) timeline.progress(1);
      if (running) timeline.play();
      else timeline.pause();
    };
    const stopWatch = watchPlayback(frame, sync, zone);
    return () => {
      stopWatch();
      timeline.kill();
      stage.innerHTML = markup;
    };
  });
}
