// The steps of the tool runs of ToolRun.tsx, as agent-chat-tool-run.tsx, agent-chat-tool-run.css,
// and use-agent-chat-row-entry-motion.ts move them. The first call of a run brings the run in as a
// new row of the transcript. A later call joins the run with a short fade and rise. In a long run,
// the latest calls move up for a new call, and the oldest of them goes out under the bar of the
// earlier calls. A call that ends swaps its bars for the icon of its tool. A run folds when its
// calls all ended and another row follows it, as the collapseFinishedToolCalls setting does.
import { all, data, must } from "../../motion/dom";
import { designPixel } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";
import { asCallKind, earlierCallCount, runCounts, runTitle, showEarlierLabel } from "./tool-runs";

/** Seconds of the motions of the chat of the app. */
const MOTION = {
  /** A new row of the transcript: use-agent-chat-row-entry-motion.ts. */
  row: 0.2,
  /** A call that joins a run that shows: tool-line-enter. */
  line: 0.2,
  /** A part of a call that a new state brings, such as its command: tool-line-swap-in. */
  swap: 0.18,
  /** The icon of a call that changes its state: tool-call-icon-swap-in. */
  icon: 0.22,
  /** A run that folds: the exit of tool-run-reveal. */
  fold: 0.22,
  /** The latest calls of a long run, which move up for a new call. */
  slide: 0.24,
} as const;

/** A new row of the transcript comes in with a short fade and a rise of 6 pixels. */
export function rowEntry(row: HTMLElement): gsap.core.Tween {
  return gsap.fromTo(
    row,
    { autoAlpha: 0, y: 6 * designPixel(row) },
    {
      autoAlpha: 1,
      y: 0,
      duration: MOTION.row,
      ease: EASE.chat,
      clearProps: "opacity,visibility,transform",
    },
  );
}

/**
 * The call or the tool line `line` ends: its icon fades and grows in. Its command or its summary
 * keeps its place: the app fades the same text in again for 180 ms, which reads as a blink in a
 * video, most of all in a time lapse. A line without a call icon, such as the line of
 * BrowserToolCard, only ends.
 */
export function endLine(scene: Scene, line: HTMLElement): void {
  line.removeAttribute("data-running");
  const icon = line.querySelector("[data-call-icon]");
  if (!(icon instanceof HTMLElement)) return;
  scene.run(
    gsap.fromTo(
      icon,
      { autoAlpha: 0, scale: 0.6 },
      {
        autoAlpha: 1,
        scale: 1,
        duration: MOTION.icon,
        ease: EASE.chat,
        clearProps: "opacity,visibility,transform",
      },
    ),
  );
}

/** The transcript track around `element`. */
export function trackOf(element: HTMLElement): HTMLElement {
  const track = element.closest("[data-track]");
  if (!(track instanceof HTMLElement)) throw new Error("The row is in no transcript track.");
  return track;
}

/** The rows of the transcript of `track`: its children, and the children of its turns. */
function rowsOf(track: Element): HTMLElement[] {
  return [...track.children].flatMap((child) => {
    if (!(child instanceof HTMLElement)) return [];
    return child.matches("[data-session], [data-turn]") ? rowsOf(child) : [child];
  });
}

/** The tool runs of the transcripts in `root`. */
export function toolRuns(scene: Scene, root: HTMLElement) {
  /** The rows that the scene shows later. At build time, they do not follow a run yet. */
  const later = new Set<HTMLElement>();

  const runOf = (call: HTMLElement): HTMLElement => {
    const run = call.closest("[data-tool-run]");
    if (!(run instanceof HTMLElement)) throw new Error("The call is in no tool run.");
    return run;
  };
  const added = (run: HTMLElement): HTMLElement[] =>
    all(run, "[data-run-list] > [data-row]").filter((call) => !call.hidden);
  /**
   * The element shows in the transcript `track`: neither it nor a wrapper of it in the track is
   * hidden. At build time, a row that the scene shows later does not show yet.
   */
  const shows = (element: HTMLElement, track: HTMLElement, building: boolean): boolean => {
    if (building && later.has(element)) return false;
    for (let node: HTMLElement | null = element; node && node !== track; node = node.parentElement)
      if (node.hidden) return false;
    return true;
  };

  /** The calls of the run all ended, and another row of its transcript follows it. */
  const settled = (run: HTMLElement, building: boolean): boolean => {
    if (added(run).some((call) => call.hasAttribute("data-running"))) return false;
    const track = trackOf(run);
    const rows = rowsOf(track);
    const place = rows.findIndex((row) => row.contains(run));
    return rows.slice(place + 1).some((row) => shows(row, track, building));
  };

  /** The header and the window of the added calls of `run`. */
  const layout = (run: HTMLElement): void => {
    const calls = added(run);
    const kinds = calls.map((call) => asCallKind(data(call, "kind")));
    const title = runTitle(kinds);
    run.dataset.title = title;
    must(run, "[data-run-title]").textContent = title;
    must(run, "[data-run-counts]").textContent = runCounts(kinds);
    const earlier = earlierCallCount(calls.length);
    run.toggleAttribute("data-long", earlier > 0);
    must(run, "[data-run-bar]").hidden = earlier === 0;
    must(run, "[data-run-earlier]").textContent = showEarlierLabel(earlier);
    calls.forEach((call, index) => call.toggleAttribute("data-earlier", index < earlier));
  };

  const setFolded = (run: HTMLElement, folded: boolean): void => {
    run.toggleAttribute("data-folded", folded);
    must(run, "[data-run-body]").hidden = folded;
  };

  /**
   * Build time: a run with no call hides, and each other run folds when it settled before the rows
   * that come later.
   */
  const arrange = (): void => {
    for (const run of all(root, "[data-tool-run]")) {
      const empty = added(run).length === 0;
      if (empty) run.hidden = true;
      setFolded(run, !empty && settled(run, true));
    }
  };

  /** Build time: the scene shows the row `row` later, so it hides until then. */
  const comesLater = (row: HTMLElement): void => {
    row.hidden = true;
    later.add(row);
    arrange();
  };

  /** Build time: the call `call` joins its run later. */
  const prepare = (call: HTMLElement): void => {
    call.removeAttribute("data-running");
    comesLater(call);
    layout(runOf(call));
  };

  /** Build time: the call `call` runs in the first frame, so its run is open. */
  const hold = (call: HTMLElement): void => {
    call.toggleAttribute("data-running", true);
    arrange();
  };

  /** The latest calls of a long run move up for a new call, and the oldest goes out. */
  const slide = (run: HTMLElement): void => {
    const calls = added(run);
    const leaving = calls[earlierCallCount(calls.length) - 1];
    if (!leaving) return;
    leaving.removeAttribute("data-earlier");
    leaving.toggleAttribute("data-leaving", true);
    scene.run(
      gsap.fromTo(
        must(run, "[data-run-list]"),
        { y: leaving.offsetHeight },
        {
          y: 0,
          duration: MOTION.slide,
          ease: EASE.chat,
          clearProps: "transform",
          onComplete: () => {
            leaving.removeAttribute("data-leaving");
            leaving.toggleAttribute("data-earlier", true);
          },
        },
      ),
    );
  };

  /** The call `call` joins its run now. A running call shows its bars. */
  const add = (call: HTMLElement, running: boolean): void => {
    const run = runOf(call);
    const first = run.hidden || added(run).length === 0;
    call.hidden = false;
    call.toggleAttribute("data-running", running);
    setFolded(run, false);
    layout(run);
    if (first) {
      run.hidden = false;
      scene.run(rowEntry(run));
    } else if (run.hasAttribute("data-long")) {
      slide(run);
    } else {
      scene.run(
        gsap.fromTo(
          call,
          { autoAlpha: 0, y: 4 * designPixel(call) },
          {
            autoAlpha: 1,
            y: 0,
            duration: MOTION.line,
            ease: EASE.chat,
            clearProps: "opacity,visibility,transform",
          },
        ),
      );
    }
  };

  /** Each run that shows and settled folds now: its chevron turns, and its calls close. */
  const settle = (): void => {
    for (const run of all(root, "[data-tool-run]")) {
      if (!shows(run, trackOf(run), false) || run.hasAttribute("data-folded")) continue;
      if (!settled(run, false)) continue;
      run.toggleAttribute("data-folded", true);
      const body = must(run, "[data-run-body]");
      scene.run(
        gsap.fromTo(
          body,
          { height: body.offsetHeight, opacity: 1 },
          {
            height: 0,
            opacity: 0,
            duration: MOTION.fold,
            ease: EASE.chat,
            onComplete: () => {
              body.hidden = true;
              gsap.set(body, { clearProps: "height,opacity" });
            },
          },
        ),
      );
    }
  };

  return {
    isCall: (row: HTMLElement): boolean => row.closest("[data-tool-run]") !== null,
    comesLater,
    prepare,
    hold,
    add,
    settle,
  };
}
