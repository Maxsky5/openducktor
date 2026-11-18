// The shots that the chapters of the release film share: where the camera puts a part of a set
// next to the captions, and how a beat lights its set, moves the camera, plays its scene, shows
// its caption, and holds its result.
import { must } from "../../motion/dom";
import type { Framed, Framing, Shot } from "../engine/camera";
import type { Film, SetRun } from "../engine/film";

/** The framing of a part next to the captions, in the right part of the frame. */
export const BESIDE: Framing = { margin: 70, offsetX: 440, maxZoom: 2.1 };

/** Seconds of the camera travel to the first set of a chapter. */
export const CHAPTER_TRAVEL = 0.95;
/** Seconds of the camera travel to the next set of a chapter. */
export const BEAT_TRAVEL = 0.8;
/** The ease of a travel from one set to the next: its top speed stays low enough to follow. */
export const TRAVEL_EASE = "power2.inOut";
/**
 * How much faster a rest plays: the pointer or the finger stays still, and the screen does not
 * change. Nothing moves, so the rest only gets shorter.
 */
export const REST = 5;
/** How much faster the pointer travels to its next target, so a short move does not drag. */
export const POINTER = 1.5;
/** How much faster the startup steps of a session play: each step still shows. */
export const STEPS = 2;

/** Finds the part `selector` of the set `name`, or the set itself. */
export function partOf(film: Film, name: string, selector?: string): () => HTMLElement {
  const set = `[data-set="${name}"]`;
  return () => must(film.root, selector ? `${set} ${selector}` : set);
}

/** The shot that frames every part that `finds` return together, as one box. */
export function unionShot(
  film: Film,
  finds: readonly (() => HTMLElement)[],
  framing: Framing = BESIDE,
): () => Framed {
  return () => {
    const boxes = finds.map((find) => film.camera.boxOf(find()));
    const left = Math.min(...boxes.map((box) => box.x));
    const top = Math.min(...boxes.map((box) => box.y));
    const right = Math.max(...boxes.map((box) => box.x + box.width));
    const bottom = Math.max(...boxes.map((box) => box.y + box.height));
    return film.camera.frame(
      { x: left, y: top, width: right - left, height: bottom - top },
      framing,
    );
  };
}

/** The shot that frames the part that `find` returns. */
export function shotOf(
  film: Film,
  find: () => HTMLElement,
  framing: Framing = BESIDE,
): () => Framed {
  return () => film.camera.frame(film.camera.boxOf(find()), framing);
}

/** One beat of a chapter: a scene that plays under one caption, up to its result. */
export type Beat = {
  /** The set of the scene. */
  set: string;
  /** The caption of the beat. */
  caption: string;
  /** The mark of the scene that happens `lead` seconds after the camera arrives. */
  mark: string;
  lead?: number;
  /** The part of the set that the camera frames first, and how. */
  part?: string;
  /** The shot of the camera on the set, in place of `part`. */
  shot?: () => Shot;
  framing?: Framing;
  /** The result of the beat: the beat ends `hold` seconds after this mark of the scene. */
  result: { mark: string; hold: number };
  /** Seconds of the camera travel to the set. */
  travel: number;
};

/** The run of a beat and the end of its caption. */
export type BeatRun = {
  run: SetRun;
  /**
   * Hides the caption at the end of the beat and stops the scene there, so the set keeps its
   * result while the camera leaves. Returns the end.
   */
  close: () => number;
  /**
   * Hides the caption at the end of the beat, for a scene that plays on in the next beat or that
   * the chapter stops itself. Returns the end.
   */
  hideCaption: () => number;
};

/**
 * Plays a beat from `at`: the set lights up while the camera travels to it, the caption shows, and
 * the scene plays so that its mark happens `lead` seconds after the camera arrives. The beat ends
 * when its result has shown for `hold` seconds, so a chapter adds its speed changes and its push
 * ins first, then closes the beat.
 */
export function playBeat(film: Film, beat: Beat, at: number): BeatRun {
  const arrived = at + beat.travel;
  const run = film.play(beat.set, beat.mark, arrived + (beat.lead ?? 0));
  film.light(beat.set, at, arrived);
  const shot = beat.shot ?? shotOf(film, partOf(film, beat.set, beat.part), beat.framing);
  film.camera.move(shot, at, beat.travel, TRAVEL_EASE);
  // The caption shows while the camera travels, and at once on a beat with no travel.
  film.captions.show(beat.caption, at + Math.min(0.45, beat.travel / 2));
  const hideCaption = (): number => {
    const end = run.mark(beat.result.mark) + beat.result.hold;
    film.captions.hide(beat.caption, end - 0.2);
    return end;
  };
  return {
    run,
    hideCaption,
    close: () => {
      const end = hideCaption();
      run.freeze(end);
      return end;
    },
  };
}
