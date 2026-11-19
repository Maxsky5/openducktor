// One run of the scene of a set in a film. The run can change its speed at the marks of the scene,
// as a speed ramp of a film editor: a slow step shows a change of the UI at the speed of the app,
// and a fast step skips a wait. The scene timeline stays paused, and a driver on the master
// timeline sets its time at each step of the film, so the changes of the scene always run forward
// and in order. The marks of the scene follow each speed change.
import { must } from "../../motion/dom";
import { gsap } from "../../motion/gsap";
import { createScene, type SceneBuilder } from "../../motion/scene";

/** One run of the scene of a set, on the master timeline. */
export type SetRun = {
  /** The film time of the mark `name` of the scene, with the speeds set so far. */
  mark: (name: string) => number;
  /**
   * Plays the scene `speed` times faster than on a page from its mark `name`. Call it in the order
   * of the marks.
   */
  speed: (name: string, speed: number) => void;
  /**
   * Stops the scene at the film time `at`, so the set keeps that frame while the camera leaves it.
   * The scene plays no more, so the film can change its speed and read its marks only before `at`.
   */
  freeze: (at: number) => void;
};

/** A run and the step that adds the driver of its last speed, when the film is built. */
type DrivenRun = { run: SetRun; finish: () => void };

/** A part of a run at one speed: its film time and scene time at its start. */
type Segment = { film: number; scene: number; speed: number };

/** Builds the scene of the set `name` in `frame`, so that its mark `mark` happens at the film time `at`. */
export function createRun(
  timeline: gsap.core.Timeline,
  name: string,
  frame: HTMLElement,
  build: SceneBuilder<string>,
  mark: string,
  at: number,
): DrivenRun {
  const scene = gsap.timeline({ paused: true });
  build(createScene(frame, must(frame, "[data-stage]"), scene));
  const length = scene.duration();
  const labelOf = (label: string): number => {
    const time = scene.labels[label];
    if (time === undefined) {
      const marks = Object.keys(scene.labels).join(", ");
      throw new Error(`The ${name} scene has no mark ${label}. Its marks: ${marks}.`);
    }
    return time;
  };
  const start = at - labelOf(mark);
  if (start < 0) throw new Error(`The ${name} scene starts at ${start.toFixed(2)} s.`);

  const segments: Segment[] = [{ film: start, scene: 0, speed: 1 }];
  const lastSegment = (): Segment => {
    const segment = segments.at(-1);
    if (!segment) throw new Error(`The ${name} run has no speed.`);
    return segment;
  };
  const filmOf = (time: number): number => {
    const segment = segments.findLast((part) => part.scene <= time);
    if (!segment) throw new Error(`The ${name} scene has no time ${time.toFixed(2)} s.`);
    if (segment.speed === 0 && time > segment.scene) {
      throw new Error(`The ${name} run stops before the scene time ${time.toFixed(2)} s.`);
    }
    return segment.film + (time - segment.scene) / segment.speed;
  };
  // The driver of one segment sets the scene time from the film time, with no ease.
  const clock = { time: 0 };
  const drive = (from: Segment, sceneEnd: number): void => {
    if (from.speed === 0 || sceneEnd <= from.scene) return;
    timeline.fromTo(
      clock,
      { time: from.scene },
      {
        time: sceneEnd,
        duration: (sceneEnd - from.scene) / from.speed,
        ease: "none",
        immediateRender: false,
        onUpdate: () => {
          scene.time(clock.time, false);
        },
      },
      from.film,
    );
  };

  const setSpeed = (when: number, value: number): void => {
    const segment = lastSegment();
    if (segment.speed === 0) {
      throw new Error(`The ${name} run stops at ${segment.film.toFixed(2)} s and plays no more.`);
    }
    if (when < segment.film) {
      throw new Error(`Change the speed of the ${name} run in the order of the times.`);
    }
    const sceneAt = Math.min(length, segment.scene + (when - segment.film) * segment.speed);
    drive(segment, sceneAt);
    segments.push({ film: when, scene: sceneAt, speed: value });
  };

  const run: SetRun = {
    mark: (label) => filmOf(labelOf(label)),
    speed: (label, value) => {
      if (!(value > 0)) throw new Error(`Give the ${name} run a speed above 0, or freeze it.`);
      setSpeed(filmOf(labelOf(label)), value);
    },
    freeze: (when) => setSpeed(when, 0),
  };
  return { run, finish: () => drive(lastSegment(), length) };
}
