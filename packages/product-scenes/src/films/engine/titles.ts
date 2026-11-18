// The motion of the title cards of a release film. The opening: the title shows in the caption
// column next to a wall of every set, and the camera then dives into the first set while the
// other sets fly back to their places. The closing: the sets come back into the wall, and the
// closing card shows the name, the version, a line, and the addresses of the project.
import { all, must } from "../../motion/dom";
import { gsap } from "../../motion/gsap";
import type { Box, Camera, Framed, Shot } from "./camera";
import type { Film } from "./film";
import {
  breakMosaic,
  formMosaic,
  type MosaicLayout,
  type MosaicOptions,
  snapMosaic,
} from "./mosaic";

/** The duck rocks on the water, as the brand duck of the website does. */
const ROCK = [
  { rotate: -10, y: 1.5, duration: 0.18, ease: "sine.out" },
  { rotate: 7, y: -1, duration: 0.26, ease: "sine.inOut" },
  { rotate: -3, y: 0.5, duration: 0.22, ease: "sine.inOut" },
  { rotate: 0, y: 0, duration: 0.3, ease: "sine.out" },
];

/** The tilt of the wall: it turns toward the caption column, as a wall of screens next to a stage. */
const WALL_TILT = { rx: 6, ry: -14, rz: 0 } as const;

/**
 * Frame pixels from the center of the frame to the center of the room of the wall, on the right of
 * the caption column. The zoom fits the wall in this room.
 */
const WALL_ROOM = 380;

/**
 * Frame pixels from the center of the frame to the center of the wall: the wall sits 20 px to the
 * right of the center of its room, away from the caption column.
 */
const WALL_OFFSET = 400;

/**
 * The shot that shows `wall` on the right of the caption column, at `room` times the zoom that
 * fits it, with the tilt of the wall.
 */
function wallShot(camera: Camera, wall: Box, room: number): Required<Shot> {
  const fit = camera.frame(wall, { margin: 60, offsetX: WALL_ROOM }).zoom;
  return { ...camera.frame(wall, { offsetX: WALL_OFFSET, zoom: fit * room }), ...WALL_TILT };
}

/** Seconds that the title shows next to the wall before the camera dives. */
const TITLE_HOLD = 1.4;
/** Seconds of the dive from the wall into the first shot. */
const DIVE = 1.5;
/** The ease of the dive, for the camera and the first set together, so the set stays in view. */
const DIVE_EASE = "power3.inOut";

/** The times of the opening: when the camera dives, and when it has arrived on the first shot. */
export type IntroTimes = { dive: number; arrived: number };

type IntroOptions = {
  /** The wall of the sets, as the film lays it out before its first frame. */
  layout: MosaicLayout;
  /** The set that the camera dives into. The wall measured its product view. */
  first: HTMLElement;
  /** The shot at the end of the dive. */
  shot: Framed;
};

/**
 * Plays the opening from the start of the film. The first frame shows the title next to the wall,
 * so a feed that shows the first frame as the poster shows the name, the version, and the screens
 * of the film. The camera holds still on the wall, then dives into the view of `first` while each
 * set flies back to its place in the world. The camera follows the view of `first`, so it grows on
 * a straight line to its place in `shot` and never leaves the frame.
 */
export function playIntro(film: Film, { layout, first, shot }: IntroOptions): IntroTimes {
  const { timeline, root, camera } = film;
  const intro = must(root, "[data-intro]");
  const content = must(intro, "[data-intro-content]");
  const duck = must(intro, "[data-mark-duck]", SVGGElement);
  const place = layout.places.find(({ set }) => set === first);
  if (!place) throw new Error("The set of the first shot is not in the wall of the opening.");

  // The first frame. The film builds before its first frame, so these states apply at once.
  gsap.set(intro, { autoAlpha: 1 });
  formMosaic(layout);
  // The camera holds still on the wall while the title shows.
  const wall = wallShot(camera, layout.wall, 0.96);
  camera.place(wall);
  const dive = TITLE_HOLD;
  timeline.to(duck, { keyframes: ROCK }, 0.3);

  // The dive: the title leaves to the left, and the camera follows the view of the first set back
  // to its place. The set moves with the same ease, so the camera knows its box at each step.
  timeline.to(content, { autoAlpha: 0, x: -60, duration: 0.55, ease: "power2.in" }, dive);
  timeline.set(intro, { autoAlpha: 0 }, dive + 0.6);
  breakMosaic(timeline, layout, first, dive, DIVE, DIVE_EASE);
  const { origin, view } = place;
  const viewAt = (progress: number): Box => {
    const scale = place.scale + (1 - place.scale) * progress;
    return {
      x: origin.x + place.x * (1 - progress) + (view.x - origin.x) * scale,
      y: origin.y + place.y * (1 - progress) + (view.y - origin.y) * scale,
      width: view.width * scale,
      height: view.height * scale,
    };
  };
  const arrived = camera.follow(viewAt, { from: wall, to: shot }, dive, DIVE, DIVE_EASE);
  return { dive, arrived };
}

/** Seconds of the fade of the world to the backdrop and back, in the closing. */
const FADE_OUT = 0.35;
const FADE_IN = 0.6;

/**
 * Plays the closing from `at`: the world fades to the backdrop, the wall forms while nothing
 * shows, and the world comes back on the wall, turned toward the closing card in the caption
 * column. Returns the time when the card has been on screen long enough to read it.
 */
export function playOutro(film: Film, at: number, options: MosaicOptions): number {
  const { timeline, root, camera, chapters } = film;
  const outro = must(root, "[data-outro]");
  const lockup = must(outro, "[data-outro-lockup]");
  const duck = must(outro, "[data-mark-duck]", SVGGElement);
  const line = must(outro, "[data-outro-line]");
  const links = all(outro, "[data-outro-link]");
  const viewport = must(root, "[data-viewport]");

  chapters.hide(at);
  timeline.to(viewport, { autoAlpha: 0, duration: FADE_OUT, ease: "power1.in" }, at);
  const formed = at + FADE_OUT;
  film.lightAll(formed);
  const wall = snapMosaic(film, formed, options);
  camera.cut(() => wallShot(camera, wall(), 0.84), formed);
  timeline.to(viewport, { autoAlpha: 1, duration: FADE_IN, ease: "power1.out" }, formed);

  // The parts take their first state with the card, so no part shows before it moves in.
  const card = formed + 0.15;
  timeline.set(outro, { autoAlpha: 1 }, card);
  timeline.set(lockup, { autoAlpha: 0, y: 40, scale: 0.94 }, card);
  timeline.set(line, { autoAlpha: 0, y: 20 }, card);
  timeline.set(links, { autoAlpha: 0, y: 26, scale: 0.96 }, card);
  timeline.to(lockup, { autoAlpha: 1, y: 0, scale: 1, duration: 1.0, ease: "power3.out" }, card);
  timeline.to(duck, { keyframes: ROCK }, card + 0.5);
  timeline.to(line, { autoAlpha: 1, y: 0, duration: 0.8, ease: "power3.out" }, card + 0.6);
  timeline.to(
    links,
    { autoAlpha: 1, y: 0, scale: 1, duration: 0.7, ease: "back.out(1.5)", stagger: 0.14 },
    card + 1.0,
  );
  // The card holds long enough to read each address.
  return card + 4.4;
}
