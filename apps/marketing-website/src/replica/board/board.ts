// The Kanban board of Lane.astro and TaskCard.astro: lane counts, board scroll, and card moves.
import { all, cloneTemplate, must } from "../../motion/dom";
import { offsetIn } from "../../motion/offset";
import { settleIn } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";
import { laneCountLabel } from "../format";
import type { Activity, LaneId } from "../vocabulary";

function laneOf(element: Element): HTMLElement {
  const lane = element.closest("[data-lane]");
  if (!(lane instanceof HTMLElement)) throw new Error("Scene card is outside a lane.");
  return lane;
}

/** Shows the activity of the session of a card: working, waiting for input, or idle. */
export function setActivity(card: HTMLElement, activity: Activity): void {
  card.dataset.activity = activity;
}

/** The parts of the Kanban board in the stage of `scene`, and the session step of its cards. */
export function boardOf(scene: Scene) {
  const track = must(scene.stage, "[data-board-track]");
  const lane = (id: LaneId): HTMLElement => must(track, `[data-lane="${id}"]`);
  const body = (id: LaneId): HTMLElement => must(lane(id), "[data-lane-body]");
  const card = (name: string): HTMLElement => must(track, `[data-card="${name}"]`);
  /** The session of a card starts or ends at `at`. */
  const running = (target: HTMLElement, on: boolean, at: number): void =>
    scene.at(at, () => setActivity(target, on ? "working" : "idle"));
  return { track, lane, body, card, running };
}

/** The number of cards in a lane. */
export function laneCount(lane: HTMLElement): number {
  return all(lane, "[data-lane-body] > [data-card]").length;
}

/** Writes a lane count in the product format, in the header pill and the collapsed dot. */
export function setLaneCount(lane: HTMLElement, count: number): void {
  must(lane, "[data-lane-count]").textContent = laneCountLabel(count);
  must(lane, "[data-lane-dot]").textContent = String(count);
}

/** The board scroll that shows all of `element`, like the horizontal scroll of the board. */
function scrollFor(track: HTMLElement, element: HTMLElement): number {
  const viewport = track.parentElement;
  if (!viewport) throw new Error("Board track needs a viewport.");
  const pad = Number.parseFloat(getComputedStyle(track).paddingLeft);
  const width = viewport.clientWidth;
  const max = Math.max(0, track.scrollWidth - width);
  const left = element.offsetLeft - pad;
  const right = element.offsetLeft + element.offsetWidth + pad;
  let next = -Number(gsap.getProperty(track, "x"));
  if (right > next + width) next = right - width;
  if (left < next) next = left;
  return Math.min(max, Math.max(0, next));
}

/** Scrolls the board so all of `element` shows. */
export function scrollBoardTo(
  scene: Scene,
  track: HTMLElement,
  element: HTMLElement,
  at: number,
  duration = 0.8,
): void {
  scene.at(at, () => {
    const next = scrollFor(track, element);
    if (Math.abs(next + Number(gsap.getProperty(track, "x"))) < 1) return;
    scene.run(gsap.to(track, { x: -next, duration, ease: EASE.move }));
  });
}

/** Opens a collapsed lane. Returns the time when the lane is open. */
export function openLane(scene: Scene, lane: HTMLElement, at: number, duration = 0.45): number {
  scene.at(at, () => {
    if (!lane.hasAttribute("data-collapsed"))
      throw new Error(`Lane ${lane.dataset.lane} is already open at ${at} s.`);
    const from = lane.offsetWidth;
    lane.removeAttribute("data-collapsed");
    scene.run(
      gsap.fromTo(
        lane,
        { width: from },
        { width: lane.offsetWidth, duration, ease: EASE.move, clearProps: "width" },
      ),
    );
  });
  return at + duration;
}

/** Replaces the children of `target` with the children of template `name`. */
export function swapIn<Template extends string>(
  scene: Scene<Template>,
  target: HTMLElement,
  name: Template,
  at: number,
): void {
  const next = scene.templateOf(name);
  scene.at(at, () => {
    target.replaceChildren(...cloneTemplate(next).childNodes);
    scene.run(settleIn(target.children));
  });
}

type MoveOptions = {
  /** Collapses a lane when its last card leaves, as the Collapsed empty column setting does. */
  collapseEmpty?: boolean;
  /** Scrolls the board with the card, so the whole target lane shows when the card lands. */
  follow?: boolean;
};

/** Where a card lands, and how the two lanes change width, in the final layout of the board. */
type Landing = {
  track: HTMLElement;
  source: HTMLElement;
  destination: HTMLElement;
  slot: HTMLElement;
  from: { x: number; y: number };
  to: { x: number; y: number };
  gap: number;
  height: number;
  width: number;
  opens: boolean;
  closes: boolean;
  widths: { source: [number, number]; destination: [number, number] };
  scroll: number | null;
};

/** Measures the move of `card` to the bottom of `target` in the final layout of the board. */
function measureLanding(card: HTMLElement, target: HTMLElement, options: MoveOptions): Landing {
  const track = card.offsetParent;
  if (!(track instanceof HTMLElement))
    throw new Error("Scene card needs a positioned board track.");
  const source = laneOf(card);
  const destination = laneOf(target);
  const gap = Number.parseFloat(getComputedStyle(target).rowGap);
  // The slot opens with the gap above it only when a card is already in the lane.
  const slotGap = target.querySelector(":scope > [data-card]") ? gap : 0;
  const from = offsetIn(card, track);
  const height = card.offsetHeight;
  const width = card.offsetWidth;
  const opens = destination.hasAttribute("data-collapsed");
  const closes =
    options.collapseEmpty === true && source !== destination && laneCount(source) === 1;
  const start = { source: source.offsetWidth, destination: destination.offsetWidth };
  // A slot in the target lane holds the landing space of the card while its copy flies.
  const slot = document.createElement("div");
  slot.className = "card-slot";
  slot.style.height = `${height}px`;
  target.append(slot);
  // Measure the final layout: the target lane is open, and an emptied source lane is closed.
  destination.removeAttribute("data-collapsed");
  source.toggleAttribute("data-collapsed", closes);
  const to = offsetIn(slot, track);
  const end = { source: source.offsetWidth, destination: destination.offsetWidth };
  const scroll = options.follow === true ? scrollFor(track, destination) : null;
  source.removeAttribute("data-collapsed");
  gsap.set(slot, { height: 0, marginTop: -slotGap });
  return {
    track,
    source,
    destination,
    slot,
    from,
    to,
    gap,
    height,
    width,
    opens,
    closes,
    widths: {
      source: [start.source, end.source],
      destination: [start.destination, end.destination],
    },
    scroll,
  };
}

/** Adds the width changes of the two lanes to `move`: a lane opens, and an emptied lane closes. */
function moveLanes(move: gsap.core.Timeline, landing: Landing, duration: number): void {
  const { source, destination, widths } = landing;
  if (landing.opens) {
    // The title fades in while the lane widens, so the lane does not show a cut title.
    move
      .fromTo(
        destination,
        { width: widths.destination[0] },
        {
          width: widths.destination[1],
          duration: duration * 0.7,
          ease: EASE.move,
          clearProps: "width",
        },
        0,
      )
      .fromTo(
        must(destination, "[data-lane-title]"),
        { autoAlpha: 0 },
        { autoAlpha: 1, duration: 0.3, clearProps: "opacity,visibility" },
        duration * 0.45,
      );
  }
  if (landing.closes) {
    // The title fades out, the lane narrows, and then the collapsed marker fades in.
    const title = must(source, "[data-lane-title]");
    const narrowed = duration * 0.85;
    move
      .to(title, { autoAlpha: 0, duration: 0.2 }, duration * 0.15)
      .fromTo(
        source,
        { width: widths.source[0] },
        { width: widths.source[1], duration: duration * 0.6, ease: EASE.move },
        duration * 0.25,
      )
      .call(
        () => {
          source.toggleAttribute("data-collapsed", true);
          gsap.set([source, title], { clearProps: "width,opacity,visibility" });
        },
        [],
        narrowed,
      )
      .from(
        all(source, "[data-lane-dot], [data-lane-rail]"),
        { autoAlpha: 0, duration: 0.25, clearProps: "opacity,visibility", immediateRender: false },
        narrowed,
      );
  }
  if (landing.scroll !== null)
    move.to(landing.track, { x: -landing.scroll, duration, ease: EASE.travel }, 0.12);
}

/** Adds the flight of a copy of the card to `move`. The card lifts, flies, and lands. */
function moveFlight(
  move: gsap.core.Timeline,
  card: HTMLElement,
  landing: Landing,
  duration: number,
): void {
  const { track, slot, from, to, gap, height, width } = landing;
  const flyer = card.cloneNode(true);
  if (!(flyer instanceof HTMLElement)) throw new Error("Scene card clone failed.");
  flyer.toggleAttribute("data-flying", true);
  gsap.set(flyer, {
    position: "absolute",
    left: 0,
    top: 0,
    width,
    x: from.x,
    y: from.y,
    margin: 0,
    zIndex: 8,
  });
  track.append(flyer);
  gsap.set(card, { visibility: "hidden" });
  setLaneCount(landing.source, laneCount(landing.source) - 1);
  // The old place of the card closes while its slot in the target lane opens.
  move
    .to(
      card,
      { height: 0, marginTop: -gap, duration: duration * 0.6, ease: EASE.move },
      duration * 0.25,
    )
    .to(slot, { height, marginTop: 0, duration: duration * 0.55, ease: EASE.move }, duration * 0.3)
    .to(
      flyer,
      {
        scale: 1.035,
        rotation: -1.2,
        boxShadow: "0 18px 40px -12px rgb(15 23 42 / 0.35)",
        duration: 0.22,
        ease: EASE.enter,
      },
      0,
    )
    .to(flyer, { x: to.x, y: to.y, duration, ease: EASE.travel }, 0.12)
    .to(
      flyer,
      {
        scale: 1,
        rotation: 0,
        boxShadow: "0 0 0 rgb(15 23 42 / 0)",
        duration: 0.25,
        ease: EASE.move,
      },
      duration - 0.1,
    )
    .call(
      () => {
        gsap.set(card, { clearProps: "visibility,height,marginTop" });
        slot.replaceWith(card);
        flyer.remove();
        setLaneCount(landing.destination, laneCount(landing.destination));
      },
      [],
      duration + 0.15,
    );
}

/**
 * Moves a card to the bottom of another lane. A copy of the card flies across the board, and the
 * two lanes close and open the space that the card leaves and takes. A collapsed target lane
 * opens during the flight. The card lands where the final layout puts it, also when lanes change
 * width. Returns the landing time.
 */
export function moveCard(
  scene: Scene,
  card: HTMLElement,
  target: HTMLElement,
  at: number,
  duration = 0.95,
  options: MoveOptions = {},
): number {
  scene.at(at, () => {
    const landing = measureLanding(card, target, options);
    // One timeline holds the move. Its positions are seconds after the move starts.
    const move = gsap.timeline();
    moveLanes(move, landing, duration);
    moveFlight(move, card, landing, duration);
    scene.run(move);
  });
  return at + duration + 0.25;
}

/** Adds a card at the top of a lane body. The card grows in and lands. */
export function addCard(scene: Scene, target: HTMLElement, card: HTMLElement, at: number): void {
  scene.at(at, () => {
    target.prepend(card);
    setLaneCount(laneOf(target), laneCount(laneOf(target)));
    const height = card.offsetHeight;
    const gap = Number.parseFloat(getComputedStyle(target).rowGap);
    card.toggleAttribute("data-fresh", true);
    scene.run(
      gsap
        .timeline()
        .fromTo(
          card,
          { height: 0, marginBottom: -gap, autoAlpha: 0 },
          { height, marginBottom: 0, duration: 0.45, ease: EASE.move },
        )
        .fromTo(
          card,
          { autoAlpha: 0, y: -10, scale: 0.97 },
          {
            autoAlpha: 1,
            y: 0,
            scale: 1,
            duration: 0.4,
            ease: EASE.land,
            clearProps: "height,marginBottom,transform",
          },
          0.3,
        ),
    );
  });
}
