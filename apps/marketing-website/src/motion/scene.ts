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
  /** Adds an animation at the playhead, so the pause control also pauses it. Use it in `at`. */
  run: (animation: gsap.core.Animation) => void;
  /** Clones the template of the view named `name`. */
  template: (name: Template) => HTMLElement;
  /** Finds the template of the view named `name`. */
  templateOf: (name: Template) => HTMLTemplateElement;
  /** Keeps the last frame on screen until `time`, where the scene ends. */
  endAt: (time: number) => void;
};

/** The builder of a view. It gets a new scene for each run. */
export type SceneBuilder<Template extends string = never> = (scene: Scene<Template>) => void;

/** Creates the scene of one run. The templates of a view live in its frame, next to the stage. */
export function createScene(
  frame: HTMLElement,
  stage: HTMLElement,
  timeline: gsap.core.Timeline,
): Scene<string> {
  const templateOf = (name: string): HTMLTemplateElement =>
    must(frame, `template[data-tpl="${name}"]`, HTMLTemplateElement);
  return {
    stage,
    timeline,
    at: (time, change) => {
      timeline.call(change, [], time);
    },
    run: (animation) => {
      timeline.add(animation, timeline.time());
    },
    template: (name) => cloneTemplate(templateOf(name)),
    templateOf,
    endAt: (time) => {
      timeline.set({}, {}, time);
    },
  };
}
