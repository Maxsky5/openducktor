// The session transcript of the Agent Studio and the workspace chat: rows that come in one by
// one, tool rows that run, and streamed assistant messages.
import { must } from "../../motion/dom";
import { designPixel, riseIn } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { stream } from "../../motion/text";
import { EASE } from "../../motion/tokens";

/**
 * Keeps the newest transcript rows in view without a jump. The transcript pins its track to the
 * bottom, so a longer track moves up at once. The track then glides from its old place. The
 * browser reports the size changes after it lays out the page, so the glide starts then. Returns
 * the reset function for a session switch.
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
    if (shift <= 0) return;
    glide?.kill();
    gsap.set(track, { y: Number(gsap.getProperty(track, "y")) + shift });
    glide = gsap.to(track, { y: 0, duration: 0.45, ease: EASE.enter });
    scene.run(glide);
  });
  observer.observe(track);
  return () => {
    glide?.kill();
    gsap.set(track, { y: 0 });
    top = track.offsetTop;
  };
}

/** The row steps of the transcript in `root`. Rows that come later are hidden at build time. */
export function transcript(scene: Scene, root: HTMLElement) {
  /** Shows a row at once, as it rises into place. */
  const reveal = (row: HTMLElement): void => {
    row.hidden = false;
    scene.run(riseIn(row, 6 * designPixel(root)));
  };

  const show = (row: HTMLElement, at: number): number => {
    scene.at(at, () => reveal(row));
    return at;
  };

  /**
   * Shows a tool row that runs until a later step, such as the answer to a request. Returns the
   * function that ends the run at a given time.
   */
  const start = (row: HTMLElement, at: number): ((end: number) => void) => {
    const head = must(row, "[data-tool]");
    scene.at(at, () => {
      reveal(row);
      head.toggleAttribute("data-running", true);
    });
    return (end) => scene.at(end, () => head.removeAttribute("data-running"));
  };

  /** Shows a tool row that runs for `runs` seconds. Returns the end time. */
  const tool = (row: HTMLElement, at: number, runs: number): number => {
    start(row, at)(at + runs);
    return at + runs;
  };

  /** Shows a workflow tool card, such as set_spec, that runs for `runs` seconds. Returns the end time. */
  const workflow = (row: HTMLElement, at: number, runs: number): number => {
    scene.at(at, () => {
      reveal(row);
      row.toggleAttribute("data-running", true);
    });
    scene.at(at + runs, () => row.removeAttribute("data-running"));
    return at + runs;
  };

  /** Streams an assistant message. The signature shows when the turn ends. Returns the end time. */
  const say = (row: HTMLElement, at: number, wordsPerSecond = 28): number => {
    const found = row.querySelector("[data-sig]");
    const signature = found instanceof HTMLElement ? found : null;
    if (signature) signature.hidden = true;
    scene.at(at, () => {
      row.hidden = false;
    });
    const end = stream(scene, must(row, "[data-text]"), at, wordsPerSecond);
    if (signature)
      scene.at(end, () => {
        signature.hidden = false;
      });
    return end;
  };

  return { reveal, show, start, tool, workflow, say };
}
