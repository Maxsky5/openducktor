// The camera of a film. It looks at a point of the world, the layout of the sets in CSS pixels,
// with a zoom, and it can tilt the world in 3D. Each move is a tween of one state object on the
// master timeline. A move finds its target when it starts, because the scenes change their layout
// while they play. The viewport has a 3D perspective only while the world tilts: in a 3D context,
// Chromium keeps an old raster scale while the zoom changes, so the text goes soft during a move
// and sharp again when it ends.
import { must } from "../../motion/dom";
import { gsap } from "../../motion/gsap";
import { offsetIn } from "../../motion/offset";

/** The size of the film frame in pixels. */
export type FrameSize = { width: number; height: number };

type CameraState = {
  /** The world point at the center of the frame. */
  x: number;
  y: number;
  zoom: number;
  /** The tilt of the world in degrees. */
  rx: number;
  ry: number;
  rz: number;
};

/** A box in world pixels. */
export type Box = { x: number; y: number; width: number; height: number };

/** The parts of the camera state that a shot sets. The other parts keep their values. */
export type Shot = Partial<CameraState>;

/** The point and the zoom of a shot that frames a box. */
export type Framed = Pick<CameraState, "x" | "y" | "zoom">;

/** A shot with a point and a zoom, and a tilt. A missing tilt is flat. */
type FollowShot = Framed & Shot;

/**
 * How a shot frames a box. The zoom fits the box in the frame minus `margin` on each side, up to
 * `maxZoom`, unless `zoom` sets it. `offsetX` and `offsetY` move the box away from the center of
 * the frame, in frame pixels, such as to leave room for a caption.
 */
export type Framing = {
  margin?: number;
  maxZoom?: number;
  zoom?: number;
  offsetX?: number;
  offsetY?: number;
};

export type Camera = {
  /** The box of `element` in world pixels, as the layout places it now. */
  boxOf: (element: HTMLElement) => Box;
  /** The shot that frames `box`. */
  frame: (box: Box, framing?: Framing) => Framed;
  /** Puts the camera on `shot` while the film builds, for its first frame. */
  place: (shot: Shot) => void;
  /** Puts the camera at `at` on the shot that `shot` finds then, with no move. */
  cut: (shot: () => Shot, at: number) => void;
  /** Moves the camera from `at` to the shot that `shot` finds then. Returns the end time. */
  move: (shot: () => Shot, at: number, duration: number, ease?: string) => number;
  /**
   * Moves the camera from the shot `from` to the shot `to` from `at`, and keeps a box that moves in
   * the world in view: `box` gives the box at each progress of `ease`, from 0 to 1. The box moves
   * on the screen on a straight line from its place in `from` to its place in `to`, and the tilt
   * goes from the tilt of `from` to the tilt of `to` in the first part of the move. Returns the end
   * time.
   */
  follow: (
    box: (progress: number) => Box,
    shots: { from: FollowShot; to: FollowShot },
    at: number,
    duration: number,
    ease: string,
  ) => number;
  /** True when a move of the camera runs between the film times `from` and `to`. */
  moving: (from: number, to: number) => boolean;
};

/** The part of a follow move, as its eased progress, that the tilt takes to reach its end. */
const TILT_END = 0.6;

export function camera(timeline: gsap.core.Timeline, root: HTMLElement, size: FrameSize): Camera {
  const viewport = must(root, "[data-viewport]");
  const rig = must(root, "[data-rig]");
  const cam = must(root, "[data-cam]");
  const world = must(root, "[data-world]");
  const state: CameraState = { x: 0, y: 0, zoom: 1, rx: 0, ry: 0, rz: 0 };
  /** The time span of each move, which the film knows when it builds. */
  const moves: { from: number; to: number }[] = [];
  const apply = (): void => {
    const { x, y, zoom, rx, ry, rz } = state;
    const screenX = size.width / 2 - x * zoom;
    const screenY = size.height / 2 - y * zoom;
    const tilted = rx !== 0 || ry !== 0 || rz !== 0;
    viewport.toggleAttribute("data-tilted", tilted);
    rig.style.transform = tilted ? `rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg)` : "none";
    cam.style.transform = `translate(${screenX}px, ${screenY}px) scale(${zoom})`;
  };

  const boxOf = (element: HTMLElement): Box => {
    if (element.offsetParent === null) {
      const hooks = [...element.attributes].map((attribute) => attribute.name).join(" ");
      throw new Error(
        `The camera frames a part that does not show at ${timeline.time().toFixed(2)} s: <${element.localName} ${hooks}>.`,
      );
    }
    const { x, y } = offsetIn(element, world);
    return { x, y, width: element.offsetWidth, height: element.offsetHeight };
  };

  const frame = (box: Box, framing: Framing = {}): Framed => {
    const { margin = 80, maxZoom = 2.4, offsetX = 0, offsetY = 0 } = framing;
    const zoom =
      framing.zoom ??
      Math.min(
        maxZoom,
        (size.width - margin * 2 - Math.abs(offsetX) * 2) / box.width,
        (size.height - margin * 2 - Math.abs(offsetY) * 2) / box.height,
      );
    return {
      x: box.x + box.width / 2 - offsetX / zoom,
      y: box.y + box.height / 2 - offsetY / zoom,
      zoom,
    };
  };

  const place = (shot: Shot): void => {
    Object.assign(state, shot);
    apply();
  };

  const cut = (shot: () => Shot, at: number): void => {
    timeline.call(
      () => {
        Object.assign(state, shot());
        apply();
      },
      [],
      at,
    );
  };

  const move = (shot: () => Shot, at: number, duration: number, ease = "power3.inOut"): number => {
    moves.push({ from: at, to: at + duration });
    timeline.call(
      () => {
        timeline.add(
          gsap.to(state, { ...shot(), duration, ease, overwrite: "auto", onUpdate: apply }),
          at,
        );
      },
      [],
      at,
    );
    return at + duration;
  };

  const follow: Camera["follow"] = (box, { from, to }, at, duration, ease) => {
    const screenOf = (target: Box, { x, y, zoom }: Framed): Box => ({
      x: size.width / 2 + (target.x - x) * zoom,
      y: size.height / 2 + (target.y - y) * zoom,
      width: target.width * zoom,
      height: target.height * zoom,
    });
    const start = screenOf(box(0), from);
    const end = screenOf(box(1), to);
    const mix = (a: number, b: number, progress: number): number => a + (b - a) * progress;
    const progress = { value: 0 };
    moves.push({ from: at, to: at + duration });
    timeline.fromTo(
      progress,
      { value: 0 },
      {
        value: 1,
        duration,
        ease,
        immediateRender: false,
        onUpdate: () => {
          const { value } = progress;
          // The tilt ends before the move, so the camera is flat, and the text sharp, while it
          // lands.
          const tilt = Math.min(1, value / TILT_END);
          const world = box(value);
          const zoom = mix(start.width, end.width, value) / world.width;
          Object.assign(state, {
            x: world.x + (size.width / 2 - mix(start.x, end.x, value)) / zoom,
            y: world.y + (size.height / 2 - mix(start.y, end.y, value)) / zoom,
            zoom,
            rx: mix(from.rx ?? 0, to.rx ?? 0, tilt),
            ry: mix(from.ry ?? 0, to.ry ?? 0, tilt),
            rz: mix(from.rz ?? 0, to.rz ?? 0, tilt),
          });
          apply();
        },
      },
      at,
    );
    return at + duration;
  };

  const moving = (from: number, to: number): boolean =>
    moves.some((span) => span.from < to && from < span.to);

  apply();
  return { boxOf, frame, place, cut, move, follow, moving };
}
