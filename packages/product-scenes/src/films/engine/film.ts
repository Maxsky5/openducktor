// The tools of a film and its mount. A film puts the scenes of the package side by side in one
// world, plays each scene on the master timeline, and moves a camera over the world. Captions, a
// chapter bar, and titles show over the camera. A film builder schedules everything at absolute
// times, and it reads the marks of the scenes to stay in time with them.
import { all, data, must } from "../../motion/dom";
import { gsap } from "../../motion/gsap";
import { stepForward } from "../../motion/mount";
import type { SceneBuilder } from "../../motion/scene";
import { SCENES } from "../../registry";
import { FILMS, type FilmName } from "../registry";
import { type Camera, camera, type FrameSize } from "./camera";
import { type Captions, captionTrack, type KeyCastTrack, keyTrack } from "./captions";
import { type Chapters, chapterBar } from "./chapters";
import { createRun, type SetRun } from "./run";

export type { SetRun } from "./run";

export type Film = {
  timeline: gsap.core.Timeline;
  root: HTMLElement;
  camera: Camera;
  captions: Captions;
  /** The keys that the visitor holds, which the caption column shows. */
  keys: KeyCastTrack;
  chapters: Chapters;
  /**
   * Plays the scene of the set `name` on the master timeline, so that its mark `mark` happens at
   * the film time `at`. Before the scene starts, the set shows the first frame of the scene. After
   * its end, the set keeps its last frame.
   */
  play: (name: string, mark: string, at: number) => SetRun;
  /**
   * Lights the set `name` for a camera travel from `at` to `arrive`. The set shows at once before
   * the camera leaves, while it is out of the frame, and the sets that were lit before go dark when
   * the camera arrives, once they are out of the frame. So no set fades on screen, and the other
   * sets stay dark. Call `light` and `lightAll` in the order of the times.
   */
  light: (name: string, at: number, arrive: number) => void;
  /** Lights every set from `at`, such as for the closing. */
  lightAll: (at: number) => void;
  /** Keeps the last frame on screen until `time`, where the film ends. Each film builder calls it. */
  endAt: (time: number) => void;
};

/** The builder of a film. */
export type FilmBuilder = (film: Film) => void;

/** The builder of the scene of each set, by the name of the set. */
type SetBuilders = ReadonlyMap<string, SceneBuilder<string>>;

/** The controls of a mounted film, for a frame renderer and a preview. */
export type FilmHandle = {
  /** The length of the film in seconds. */
  duration: number;
  /** Shows the frame at `time`. The time must not go back. */
  seek: (time: number) => void;
  /** True when the camera moves between the film times `from` and `to`. */
  moving: (from: number, to: number) => boolean;
};

/** The time that shows as the first frame: the changes at 0 render, and no motion starts yet. */
const FIRST_FRAME = 1e-4;

/**
 * The film tools, the end of the film that `endAt` sets, and the step that adds the last driver of
 * each run once the builder has set every speed.
 */
type Built = { film: Film; end: () => number | undefined; finish: () => void };

function createFilm(
  root: HTMLElement,
  timeline: gsap.core.Timeline,
  size: FrameSize,
  builders: SetBuilders,
): Built {
  const played = new Set<string>();
  const finishers: (() => void)[] = [];
  const sets = all(root, "[data-set]");
  const setOf = (name: string): HTMLElement => must(root, `[data-set="${name}"]`);
  // Every set starts dark, and a dark set does not paint, so the browser keeps the memory of its
  // tiles for the sets on screen. The film lights the set of each beat.
  gsap.set(sets, { autoAlpha: 0 });
  // The sets that show after the steps that the builder has scheduled so far.
  let lit: HTMLElement[] = [];

  const light = (name: string, at: number, arrive: number): void => {
    const set = setOf(name);
    if (!lit.includes(set)) timeline.set(set, { autoAlpha: 1 }, at);
    const others = lit.filter((other) => other !== set);
    if (others.length > 0) timeline.set(others, { autoAlpha: 0 }, arrive);
    lit = [set];
  };

  const play = (name: string, mark: string, at: number): SetRun => {
    if (played.has(name)) throw new Error(`The film plays the ${name} set twice.`);
    played.add(name);
    const build = builders.get(name);
    if (!build) throw new Error(`The film has no builder for the ${name} set.`);
    const frame = must(root, `[data-set="${name}"] > [data-scene]`);
    const { run, finish } = createRun(timeline, name, frame, build, mark, at);
    finishers.push(finish);
    return run;
  };

  let end: number | undefined;
  const film: Film = {
    timeline,
    root,
    camera: camera(timeline, root, size),
    captions: captionTrack(timeline, root),
    keys: keyTrack(timeline, root),
    chapters: chapterBar(timeline, root),
    play,
    light,
    lightAll: (at) => {
      timeline.set(sets, { autoAlpha: 1 }, at);
      lit = sets;
    },
    endAt: (time) => {
      end = time;
      timeline.set({}, {}, time);
    },
  };
  return {
    film,
    end: () => end,
    finish: () => {
      for (const finish of finishers) finish();
    },
  };
}

/** Loads the builder of the scene of each set in `root`. A set holds a loop scene of the registry. */
async function loadSetBuilders(root: HTMLElement): Promise<SetBuilders> {
  const entries = await Promise.all(
    all(root, "[data-set]").map(async (set) => {
      const name = data(set, "set");
      const entry = Object.entries(SCENES).find(([scene]) => scene === name)?.[1];
      if (!entry || !("timeline" in entry)) {
        throw new Error(`The set ${name} must hold a loop scene of the registry.`);
      }
      return [name, await entry.timeline()] as const;
    }),
  );
  return new Map(entries);
}

/**
 * Builds the film `name` in `root`, the element with `data-film` that its view renders, and shows
 * its first frame. It loads the builder of the film and the builders of the scenes of its sets.
 * The film measures the layout of the page while it builds, so load the fonts first. The film
 * plays only forward, in steps, because the scenes change the page in timeline callbacks.
 */
export async function mountFilm(root: HTMLElement, name: FilmName): Promise<FilmHandle> {
  const { size, timeline: loadBuild } = FILMS[name];
  const [build, builders] = await Promise.all([loadBuild(), loadSetBuilders(root)]);
  const timeline = gsap.timeline({ paused: true });
  const built = createFilm(root, timeline, size, builders);
  build(built.film);
  built.finish();
  // The film ends where the builder says, even when a scene runs on after it in the dark.
  const duration = built.end();
  if (duration === undefined) throw new Error(`The builder of the ${name} film must call endAt.`);
  let current = 0;
  // A paused timeline at 0 does not render the changes at 0, so the first frame renders them.
  timeline.time(FIRST_FRAME, false);
  return {
    duration,
    seek: (time) => {
      if (!(time >= current - 1e-6 && time <= duration)) {
        throw new Error(
          `Seek from ${current.toFixed(3)} s to a later time up to ${duration.toFixed(2)} s, not ${time} s.`,
        );
      }
      stepForward(current, time, (at) => timeline.time(at, false));
      current = time;
    },
    moving: built.film.camera.moving,
  };
}
