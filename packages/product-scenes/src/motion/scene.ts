import { cloneTemplate, must } from "./dom";

/**
 * The tools of a scene builder for one run of a view. A builder prepares the first frame in the
 * fresh stage markup, then schedules each change on the paused timeline, in seconds from the
 * start. A change that measures the page runs at its time, and it adds its tweens with `run`.
 * `Template` names the templates of the view, so a scene can only ask for a template that exists.
 * A helper that uses no template takes a `Scene` without names.
 */
export type Scene<Template extends string = never> = {
  stage: HTMLElement;
  timeline: gsap.core.Timeline;
  /** Changes the view at `time`. */
  at: (time: number, change: () => void) => void;
  /**
   * Adds an animation to the timeline at the time of the current `at` change, so the pause control
   * also pauses it. Use it only in `at`.
   */
  run: (animation: gsap.core.Animation) => void;
  /**
   * Adds an animation to the timeline at its playhead. Use it for a change that the browser
   * reports later, such as a size change, which has no time on the timeline.
   */
  runNow: (animation: gsap.core.Animation) => void;
  /** Clones the template of the view named `name`. */
  template: (name: Template) => HTMLElement;
  /** Finds the stock element of the template of the view named `name`. */
  templateOf: (name: Template) => HTMLElement;
  /** Keeps the last frame on screen until `time`, where the scene ends. */
  endAt: (time: number) => void;
};

/** The builder of a view. It gets a new scene for each run. */
export type SceneBuilder<Template extends string = never> = (scene: Scene<Template>) => void;

/**
 * Creates the scene of one run. The templates of a view are stock elements in the hidden
 * `[data-stock]` container of its frame, next to the stage.
 */
export function createScene(
  frame: HTMLElement,
  stage: HTMLElement,
  timeline: gsap.core.Timeline,
): Scene<string> {
  const templateOf = (name: string): HTMLElement =>
    must(frame, `[data-stock] > [data-tpl="${name}"]`);
  // The time of the `at` change that runs now. The playhead can be later: a tick moves it to the
  // end of the frame before the change runs, and a slow frame can last up to 0.5 s.
  let changeTime: number | undefined;
  return {
    stage,
    timeline,
    at: (time, change) => {
      timeline.call(
        () => {
          changeTime = time;
          change();
          changeTime = undefined;
        },
        [],
        time,
      );
    },
    run: (animation) => {
      if (changeTime === undefined) throw new Error("Call scene.run only in a change of scene.at.");
      timeline.add(animation, changeTime);
    },
    runNow: (animation) => {
      timeline.add(animation, timeline.time());
    },
    template: (name) => cloneTemplate(templateOf(name)),
    templateOf,
    endAt: (time) => {
      timeline.set({}, {}, time);
    },
  };
}
