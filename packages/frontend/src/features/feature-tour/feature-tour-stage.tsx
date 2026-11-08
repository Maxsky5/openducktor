import type { CSSProperties, ReactElement, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { type CssVariableStyle, TOUR_FRAME_ASPECT } from "./feature-tour-geometry";

// The stage of the tour pictures: the frame of a scene, and the explainer layout of app pieces with
// numbered pins and the list of their parts.

/**
 * One slide of the tour: its text and its picture. The picture is a full picture, such as a live
 * scene, or an explainer. The dialog renders an explainer with `TourExplainer`, and it gives the
 * parts of the explainer to screen readers.
 */
export type FeatureTourSlide = {
  id: string;
  title: string;
  text: string;
} & (
  | { picture: ReactElement; explainer?: never }
  | { explainer: TourExplainerPicture; picture?: never }
);

/**
 * The frame of a picture: a rounded box with the window shadow, inset in the picture area. It
 * keeps clear of the close button of the tour, and it takes the largest size of the frame ratio
 * that fits.
 */
export function TourFrame({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="absolute inset-[var(--t-tour-inset)] grid place-items-center [container-type:size]">
      <div
        className="t-tour-window relative overflow-hidden rounded-xl border border-input bg-card text-foreground [container-type:inline-size]"
        style={{
          aspectRatio: TOUR_FRAME_ASPECT,
          width: `min(100cqw, calc(100cqh * ${TOUR_FRAME_ASPECT}))`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * A numbered pin, in app pixels of the stage. Its dot sits on the edge of its target at `x` and
 * `y`. The pin sits on `side` of the target: outside the stage, or at `from` on that axis when a
 * gap between two pieces is closer. A leader line joins the pin to the dot, so a pin never covers
 * the part that it names. With `span`, the dot becomes a bracket of that length across the line,
 * for a pin that names a group of parts.
 */
type TourPin = {
  x: number;
  y: number;
  side: "left" | "right" | "top" | "bottom";
  from?: number;
  span?: number;
};

/** One numbered part of a picture: its name, what it does, and the pin on it. */
export type TourPart = { title: string; text: string; pin: TourPin };

/** The size of a stage, in app pixels. */
type StageSize = { width: number; height: number };

/** The height in app pixels that fills the picture area. All explainers share this scale. */
const TOUR_SCALE_HEIGHT = 690;

/** The distance from a stage edge to the center of an outside pin, in screen pixels. */
const PIN_OFFSET = 30;

/** The radius of a pin, in screen pixels: the leader line stops at its edge. */
const PIN_RADIUS = 12;

const scaled = (value: number): string => `calc(${value}px * var(--t-tour-scale))`;

/** The width of the list of the parts, and the space between it and the stage pins. */
const LIST_WIDTH = "19.5rem";
const LIST_GAP = "3rem";

/** The room that the pins take outside the stage, on each side. */
const PIN_ROOM = PIN_OFFSET + PIN_RADIUS + 2;

/**
 * The scale of an explainer: the picture height over `TOUR_SCALE_HEIGHT`, so the explainers share
 * one scale. A stage too wide for the room beside the list scales down, so its app pieces keep
 * their real width.
 */
const stageScale = (width: number, sideRoom: number): CssVariableStyle => ({
  "--t-tour-scale": `min(tan(atan2(100cqh, ${TOUR_SCALE_HEIGHT}px)), tan(atan2(calc(100cqw - ${LIST_WIDTH} - ${LIST_GAP} - ${sideRoom}px), ${width}px)))`,
});

/** The room for the pins that sit outside the stage on `side`. */
const pinRoom = (parts: readonly TourPart[], side: TourPin["side"]): number =>
  parts.some(({ pin }) => pin.side === side && pin.from === undefined) ? PIN_ROOM : 0;

/** A picture that explains a part of the app. See `TourExplainer`. */
export type TourExplainerPicture = {
  width: number;
  height: number;
  /** The parts in pin order. Each part gives its number to its pin and to its line in the list. */
  parts: readonly TourPart[];
  /** The top of the list, in app pixels of the stage: the top of the piece that the pins name. */
  listTop?: number;
  /** The app pieces on the stage, placed in app pixels. */
  stage: ReactNode;
};

/**
 * A picture that explains a part of the app: real app pieces on a stage, a numbered pin on each
 * part, and the list of the parts on a card beside the stage. The stage and the list are centered
 * as one group, with the top of the list at the top of the stage. The stage is `width` by `height`
 * app pixels.
 */
export function TourExplainer({
  width,
  height,
  parts,
  listTop = 0,
  stage,
}: TourExplainerPicture): ReactElement {
  const room = {
    top: pinRoom(parts, "top"),
    right: pinRoom(parts, "right"),
    bottom: pinRoom(parts, "bottom"),
    left: pinRoom(parts, "left"),
  };
  return (
    <div className="absolute inset-0 px-[var(--t-tour-inset)] py-10 [container-type:size]">
      <div
        className="flex h-full items-center justify-center"
        style={stageScale(width, room.left + room.right)}
      >
        <div className="flex items-start" style={{ gap: LIST_GAP }}>
          <div
            className="relative shrink-0"
            style={{
              width: scaled(width),
              height: scaled(height),
              margin: `${room.top}px ${room.right}px ${room.bottom}px ${room.left}px`,
            }}
          >
            <div
              className="absolute left-0 top-0 origin-top-left"
              style={{ width, height, scale: "var(--t-tour-scale)" }}
            >
              {stage}
            </div>
            {parts.map((part, index) => (
              <TourPinMark
                key={part.title}
                n={index + 1}
                pin={part.pin}
                stage={{ width, height }}
              />
            ))}
          </div>
          <ol
            data-tour-parts=""
            className="flex shrink-0 flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm"
            style={{ width: LIST_WIDTH, marginTop: `calc(${room.top}px + ${scaled(listTop)})` }}
          >
            {parts.map((part, index) => (
              <li key={part.title} className="flex gap-3">
                <span className="t-tour-pin mt-px flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-5 text-foreground">{part.title}</p>
                  <p className="mt-0.5 text-[13px] leading-5 text-foreground/75">{part.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

/** The place of the pin on its axis: at `from` in the stage, or just outside the stage. */
const pinPlace = (pin: TourPin, stage: StageSize): string => {
  if (pin.from !== undefined) return scaled(pin.from);
  if (pin.side === "left" || pin.side === "top") return `-${PIN_OFFSET}px`;
  const edge = pin.side === "right" ? stage.width : stage.height;
  return `calc(${scaled(edge)} + ${PIN_OFFSET}px)`;
};

/** The bracket of a pin: a bar of length `span` across the leader line, centered on the target. */
const bracketStyle = (pin: TourPin, span: number, horizontal: boolean): CSSProperties =>
  horizontal
    ? { left: scaled(pin.x), top: scaled(pin.y - span / 2), height: scaled(span) }
    : { top: scaled(pin.y), left: scaled(pin.x - span / 2), width: scaled(span) };

/** A pin, its leader line, and the dot or bracket on its target. */
function TourPinMark({
  n,
  pin,
  stage,
}: {
  n: number;
  pin: TourPin;
  stage: StageSize;
}): ReactElement {
  const targetX = scaled(pin.x);
  const targetY = scaled(pin.y);
  const place = pinPlace(pin, stage);
  const horizontal = pin.side === "left" || pin.side === "right";
  const before = pin.side === "left" || pin.side === "top";
  const target = horizontal ? targetX : targetY;
  // The line runs between the edge of the pin and the target.
  const start = before ? `calc(${place} + ${PIN_RADIUS}px)` : target;
  const length = before
    ? `calc(${target} - ${place} - ${PIN_RADIUS}px)`
    : `calc(${place} - ${target} - ${PIN_RADIUS}px)`;
  const line: CSSProperties = horizontal
    ? { top: targetY, left: start, width: length }
    : { left: targetX, top: start, height: length };
  const mark: CSSProperties = horizontal
    ? { top: targetY, left: place }
    : { left: targetX, top: place };
  return (
    <>
      <span
        className={cn(
          "t-tour-pin-line absolute z-40",
          horizontal ? "h-px -translate-y-1/2" : "w-px -translate-x-1/2",
        )}
        style={line}
      />
      {pin.span === undefined ? (
        <span
          className="t-tour-pin-dot absolute z-40 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ top: targetY, left: targetX }}
        />
      ) : (
        <span
          className={cn(
            "t-tour-pin-line absolute z-40 rounded-full",
            horizontal ? "w-0.5 -translate-x-1/2" : "h-0.5 -translate-y-1/2",
          )}
          style={bracketStyle(pin, pin.span, horizontal)}
        />
      )}
      <span
        data-tour-pin=""
        className="t-tour-pin absolute z-40 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-xs font-semibold tabular-nums"
        style={mark}
      >
        {n}
      </span>
    </>
  );
}

/** A piece of the app on a stage: a rounded card that clips its content, with the window shadow. */
export function TourPiece({
  x,
  y,
  width,
  height,
  children,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  children: ReactNode;
}): ReactElement {
  return (
    <div
      className="t-tour-window absolute overflow-hidden rounded-xl border border-input bg-card text-foreground"
      style={{ left: x, top: y, width, height }}
    >
      {children}
    </div>
  );
}

/** A caption over a piece, outside the app: it names what the piece shows. */
export function TourStageCaption({
  y,
  children,
}: {
  y: number;
  children: ReactNode;
}): ReactElement {
  return (
    <p className="absolute text-[15px] font-medium text-foreground/75" style={{ left: 2, top: y }}>
      {children}
    </p>
  );
}
