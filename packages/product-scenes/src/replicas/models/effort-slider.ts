// The motion of the effort slider of EffortTrack.tsx, as step-track-animator.ts plays it. While the
// visitor drags, the thumb widens from 24 to 30 pixels and follows the pointer, and the fill and the
// raised label follow the thumb. Each time the thumb passes the middle between two stops, the label
// shows the next level: it fades in from 35 %, as step-track-label-swap does, and its flat top takes
// the new width. On release, the thumb narrows again. The value changes on release.
import { all, data, must } from "../../motion/dom";
import { designPixel } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";
import type { Drag } from "../shell/cursor";

/** Seconds of the widening and the narrowing of the thumb: DRAG_STRETCH_MS. */
const STRETCH = 0.16;
/** Seconds that the shoulder takes to fit a new label: PLATEAU_MS. */
const PLATEAU = 0.11;
/** Seconds of the label fade: step-track-label-swap. */
const LABEL_SWAP = 0.18;

/** The steps of one effort slider. */
type EffortSlider = {
  /** Build time: the thumb rests on `value`. */
  reset: (value: string) => void;
  /** The tick of `value`, for the pointer. */
  tick: (value: string) => HTMLElement;
  /** The thumb, for the pointer. */
  thumb: () => HTMLElement;
  /**
   * The pointer presses the thumb to drag it from its stop to `value`: the thumb widens. Call it in
   * the start of the drag. Returns the parts of the drag that move the thumb and release it.
   */
  grab: (value: string) => Required<Pick<Drag, "onMove" | "onRelease">>;
};

/** The effort slider `track` of EffortTrack.tsx in a scene. */
export function effortSlider(scene: Scene, track: HTMLElement): EffortSlider {
  const ticks = all(track, "[data-tick]");
  const stops = ticks.map((tick) => data(tick, "tick"));
  const label = must(track, "[data-effort-label]");
  const sizer = must(track, "[data-effort-size]");
  const plateau = must(track, "[data-plateau]");
  const thumb = must(track, "[data-thumb]");
  const span = stops.length - 1;
  const indexOf = (value: string): number => {
    const index = stops.indexOf(value);
    if (index < 0) throw new Error(`The effort track has no level ${value}.`);
    return index;
  };
  /** The stop where the thumb rests at build time, before the next drag. */
  let rest = indexOf(label.textContent ?? "");
  const state = { pos: rest, stretch: 0 };

  const reset = (value: string): void => {
    rest = indexOf(value);
    state.pos = rest;
    label.textContent = value;
    sizer.textContent = value;
    track.style.setProperty("--at", String(rest / span));
    ticks.forEach((item, index) => item.toggleAttribute("data-on", index === rest));
  };

  const tick = (value: string): HTMLElement => {
    const found = ticks[indexOf(value)];
    if (!found) throw new Error(`The effort track has no level ${value}.`);
    return found;
  };

  /** The design pixel, the length between the first and the last stop, and the x of each tick. */
  type Geometry = { pixel: number; usable: number; ticks: number[] };
  let geometry: Geometry = { pixel: 0, usable: 0, ticks: [] };

  /** Measures the track once, when the pointer grabs the thumb, so a frame of the drag only writes. */
  const measure = (): void => {
    const pixel = designPixel(track);
    const usable = track.offsetWidth - 28 * pixel;
    geometry = {
      pixel,
      usable,
      ticks: ticks.map((_, index) => 14 * pixel + (index / span) * usable),
    };
  };

  /** Puts the thumb at `state`. A tick under the thumb takes the color of the thumb tick. */
  const paint = (): void => {
    track.style.setProperty("--at", String(state.pos / span));
    track.style.setProperty("--stretch", String(state.stretch));
    const { pixel, usable } = geometry;
    const center = 14 * pixel + (state.pos / span) * usable;
    const reach = (12 + 3 * state.stretch - 0.5) * pixel;
    ticks.forEach((item, index) =>
      item.toggleAttribute("data-on", Math.abs((geometry.ticks[index] ?? 0) - center) <= reach),
    );
  };

  /**
   * The label shows the level of `index`, and its flat top takes the new width. The drag of the
   * pointer calls it while it plays, so its tweens start at the playhead.
   */
  const arrive = (index: number): void => {
    const level = stops[index];
    if (level === undefined) throw new Error(`The effort track has no stop ${index}.`);
    const before = plateau.offsetWidth;
    sizer.textContent = level;
    const after = plateau.offsetWidth;
    scene.runNow(
      gsap.fromTo(
        plateau,
        { width: before },
        { width: after, duration: PLATEAU, ease: EASE.chat, clearProps: "width" },
      ),
    );
    label.textContent = level;
    scene.runNow(
      gsap.fromTo(label, { opacity: 0.35 }, { opacity: 1, duration: LABEL_SWAP, ease: EASE.chat }),
    );
  };

  /** The thumb widens while the pointer holds it, and narrows on release. */
  const stretch = (to: number): void =>
    scene.run(gsap.to(state, { stretch: to, duration: STRETCH, ease: EASE.chat, onUpdate: paint }));

  const grab = (value: string): Required<Pick<Drag, "onMove" | "onRelease">> => {
    const from = rest;
    const target = indexOf(value);
    if (target <= from) throw new Error(`The effort drag must move up from ${stops[from]}.`);
    rest = target;
    let shown = from;
    measure();
    stretch(1);
    return {
      onMove: (progress) => {
        state.pos = from + (target - from) * progress;
        paint();
        // The label changes where the nearest stop changes: half way between two stops.
        while (shown < Math.round(state.pos)) {
          shown += 1;
          arrive(shown);
        }
      },
      onRelease: () => stretch(0),
    };
  };

  return { reset, tick, thumb: () => thumb, grab };
}
