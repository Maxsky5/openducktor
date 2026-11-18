// The session transcript of a task session and of a chat: rows that come in one by
// one, tool calls that run in their tool runs, and streamed assistant messages.
import { all, must } from "../../motion/dom";
import { designPixel, riseIn } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { stream, streamUpdates } from "../../motion/text";
import { EASE } from "../../motion/tokens";
import { endLine, rowEntry, toolRuns, trackOf } from "./runs";

/** Seconds that the track takes to glide to its new place. */
const GLIDE = 0.45;

/**
 * TEXT_STREAM_INTERVAL_MS of session-event-batching.ts in packages/frontend-core: the mobile app
 * shows the text that streams in updates 100 ms apart. Each update moves the rows above the
 * message at once, so a new line pushes them up by one line.
 */
export const PHONE_TEXT_UPDATE = 0.1;

/**
 * Keeps the newest transcript rows in view without a jump. The transcript pins its track to the
 * bottom, so a longer track moves up at once. The track then glides from its old place. The
 * browser reports the size changes after it lays out the page, so the glide starts then. While the
 * track has `data-snap`, the next size change shows at once, as use-agent-chat-scroll-controller.ts
 * keeps a pinned transcript at its end in the same frame, and the attribute goes. A glide that
 * runs keeps its course. Returns the reset function for a session switch. A phone transcript does
 * not glide: the list of the mobile app keeps the space under its latest message in place, so a
 * new row moves the rows above it at once.
 */
export function follow(scene: Scene, track: HTMLElement): () => void {
  let top: number | undefined;
  let glide: gsap.core.Tween | undefined;
  const observer = new ResizeObserver(() => {
    if (!track.isConnected) {
      observer.disconnect();
      return;
    }
    const next = track.offsetTop;
    const shift = top === undefined ? 0 : top - next;
    top = next;
    if (track.hasAttribute("data-snap")) {
      track.removeAttribute("data-snap");
      return;
    }
    if (shift <= 0) return;
    glide?.kill();
    // A size change that the browser reports near the end of the scene glides only until the
    // end, so the scene keeps its length.
    const duration = Math.min(GLIDE, scene.timeLeft());
    if (duration === 0) {
      gsap.set(track, { y: 0 });
      return;
    }
    gsap.set(track, { y: Number(gsap.getProperty(track, "y")) + shift });
    glide = gsap.to(track, { y: 0, duration, ease: EASE.enter });
    scene.runNow(glide);
  });
  observer.observe(track);
  return () => {
    glide?.kill();
    gsap.set(track, { y: 0 });
    top = track.offsetTop;
  };
}

/**
 * The row steps of the transcript in `root`. A step that shows a row later hides the row at build
 * time, and a call of a tool run leaves its run until its time. A row of the desktop chat, in a
 * `data-thread`, comes in as the app brings in a new row. Each new row and each call that ends can
 * fold a tool run before it.
 */
export function transcript(scene: Scene, root: HTMLElement) {
  const runs = toolRuns(scene, root);

  /** Shows a row at once, as it rises into place. */
  const reveal = (row: HTMLElement): void => {
    row.hidden = false;
    scene.run(row.closest("[data-thread]") ? rowEntry(row) : riseIn(row, 6 * designPixel(root)));
    runs.settle();
  };

  /** Shows a row, or adds a call that already ended to its run. Returns the time. */
  const show = (row: HTMLElement, at: number): number => {
    if (runs.isCall(row)) {
      runs.prepare(row);
      scene.at(at, () => {
        runs.add(row, false);
        runs.settle();
      });
      return at;
    }
    runs.comesLater(row);
    scene.at(at, () => reveal(row));
    return at;
  };

  /** The function that ends the running call or tool line `line` at a given time. */
  const ender =
    (line: HTMLElement) =>
    (end: number): void =>
      scene.at(end, () => {
        endLine(scene, line);
        runs.settle();
      });

  /**
   * Shows a tool call that runs until a later step, such as the answer to a request. A call of a
   * tool run joins its run. Returns the function that ends the run of the call at a given time.
   */
  const start = (row: HTMLElement, at: number): ((end: number) => void) => {
    if (runs.isCall(row)) {
      runs.prepare(row);
      scene.at(at, () => runs.add(row, true));
      return ender(row);
    }
    const head = must(row, "[data-tool]");
    runs.comesLater(row);
    scene.at(at, () => {
      reveal(row);
      head.toggleAttribute("data-running", true);
    });
    return ender(head);
  };

  /**
   * Build time: a tool call of the first frame still runs. Returns the function that ends it at a
   * given time.
   */
  const running = (row: HTMLElement): ((end: number) => void) => {
    if (runs.isCall(row)) {
      runs.hold(row);
      return ender(row);
    }
    const head = must(row, "[data-tool]");
    head.toggleAttribute("data-running", true);
    return ender(head);
  };

  /** Shows a tool call that runs for `runs` seconds. Returns the end time. */
  const tool = (row: HTMLElement, at: number, seconds: number): number => {
    start(row, at)(at + seconds);
    return at + seconds;
  };

  /** Shows an ODT tool card, such as Set Spec, that runs for `seconds`. Returns the end time. */
  const workflow = (row: HTMLElement, at: number, seconds: number): number => {
    runs.comesLater(row);
    scene.at(at, () => {
      reveal(row);
      row.toggleAttribute("data-running", true);
    });
    scene.at(at + seconds, () => row.removeAttribute("data-running"));
    return at + seconds;
  };

  /**
   * Streams an assistant message. A message of a phone shows its text in the updates of the mobile
   * app. Its signature and the separator with the time of the turn show when the turn ends, as the
   * app shows the separator only above a final message (isFinal of agent-chat-transcript-model.ts).
   * The separator comes above the message, and the pinned transcript of the app keeps the message
   * at its end in the same frame, so that change shows at once. Returns the end time.
   */
  const say = (row: HTMLElement, at: number, wordsPerSecond = 28): number => {
    const ending = all(row, "[data-sig], [data-worked]");
    const separated = ending.some((part) => part.hasAttribute("data-worked"));
    for (const part of ending) part.hidden = true;
    runs.comesLater(row);
    scene.at(at, () => {
      row.hidden = false;
      if (row.closest("[data-thread]")) scene.run(rowEntry(row));
      runs.settle();
    });
    const text = must(row, "[data-text]");
    const end = row.closest("[data-phone]")
      ? streamUpdates(scene, text, at, wordsPerSecond, PHONE_TEXT_UPDATE)
      : stream(scene, text, at, wordsPerSecond);
    if (ending.length > 0)
      scene.at(end, () => {
        if (separated) trackOf(row).toggleAttribute("data-snap", true);
        for (const part of ending) part.hidden = false;
      });
    return end;
  };

  return { reveal, show, start, running, tool, workflow, say };
}
