// One run of the scene of a set in a film. The run can change its speed at film times, as a speed
// ramp of a film editor: a slow step shows a change of the UI at the speed of the app, and a fast
// step skips a wait. The scene timeline stays paused, and a driver on the master timeline sets its
// time at each step of the film, so the changes of the scene always run forward and in order. The
// marks of the scene follow each speed change.
import { gsap } from "../../motion/gsap";
import { createScene, type SceneBuilder } from "../../motion/scene";

/** How a film plays the scene of a set. */
export type PlayOptions = {
  /** How many times faster than on a page the scene plays first. */
  speed?: number;
  /** The mark of the scene that happens at the film time `at`. Without it, the scene starts at `at`. */
  mark?: string;
};

/** One run of the scene of a set, on the master timeline. */
export type SetRun = {
  /** The film time of the mark `name` of the scene. */
  mark: (name: string) => number;
  /**
   * The film time when the scene is `offset` seconds of the scene after its mark `name`, with the
   * speeds set so far. A speed change uses it to start at a step of the scene.
   */
  at: (name: string, offset: number) => number;
  /**
   * Plays the scene `speed` times faster than on a page from the film time `at`. Call it in the
   * order of the times.
   */
  speed: (at: number, speed: number) => void;
  /**
   * Stops the scene at the film time `at`, so the set keeps that frame while the camera leaves it.
   * The scene plays no more, so the film can read no mark after it.
   */
  freeze: (at: number) => void;
  /** The root of the scene, to find a part of it. */
  root: HTMLElement;
};

/** A run and the step that adds the driver of its last speed, when the film is built. */
export type DrivenRun = { run: SetRun; finish: () => void };

/** A part of a run at one speed: its film time and scene time at its start. */
type Segment = { film: number; scene: number; speed: number };

export function createRun(
  timeline: gsap.core.Timeline,
  name: string,
  frame: HTMLElement,
  build: SceneBuilder<string>,
  at: number,
  { speed = 1, mark }: PlayOptions,
): DrivenRun {
  const stage = frame.querySelector("[data-stage]");
  if (!(stage instanceof HTMLElement)) throw new Error(`The ${name} scene has no stage.`);
  const scene = gsap.timeline({ paused: true });
  build(createScene(frame, stage, scene));
  const length = scene.duration();
  const labelOf = (label: string): number => {
    const time = scene.labels[label];
    if (time === undefined) {
      const marks = Object.keys(scene.labels).join(", ");
      throw new Error(`The ${name} scene has no mark ${label}. Its marks: ${marks}.`);
    }
    return time;
  };
  const start = mark === undefined ? at : at - labelOf(mark) / speed;
  if (start < 0) throw new Error(`The ${name} scene starts at ${start.toFixed(2)} s.`);

  const segments: Segment[] = [{ film: start, scene: 0, speed }];
  const lastSegment = (): Segment => {
    const segment = segments.at(-1);
    if (!segment) throw new Error(`The ${name} run has no speed.`);
    return segment;
  };
  const filmOf = (time: number): number => {
    const segment = segments.findLast((part) => part.scene <= time) ?? lastSegment();
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
    if (when < segment.film) {
      throw new Error(`Change the speed of the ${name} run in the order of the times.`);
    }
    const sceneAt = Math.min(length, segment.scene + (when - segment.film) * segment.speed);
    drive(segment, sceneAt);
    segments.push({ film: when, scene: sceneAt, speed: value });
  };

  const run: SetRun = {
    mark: (label) => filmOf(labelOf(label)),
    at: (label, offset) => filmOf(labelOf(label) + offset),
    speed: (when, value) => {
      if (!(value > 0)) throw new Error(`Give the ${name} run a speed above 0, or freeze it.`);
      setSpeed(when, value);
    },
    freeze: (when) => setSpeed(when, 0),
    root: frame,
  };
  return { run, finish: () => drive(lastSegment(), length) };
}
