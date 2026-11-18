// The steps of the tool runs of ToolRun.tsx in a mobile session, as tool-run-rows.tsx,
// tool-status.tsx, and fold-reveal.tsx move them in
// apps/mobile/src/features/session/transcript/rows. A call that joins an open run fades and rises
// in. While a call runs, moving bars take the place of its icon. When it ends, the icon of its tool
// grows in with icon-swap.ts, and its run time shows. Its name and its command stay in place. The
// app fades them in again from transparent, but their text does not change, so the replica keeps
// them still and the line does not blink. A run opens and folds with the FLIP motion of
// transcript-fold-motion.ts: the run takes its new height at once, and the run and the rows over
// it glide from their old place to the new one, because the transcript keeps its latest row in
// place. The rows under the run cover its calls on the screen color while they move.
import { all, must } from "../../motion/dom";
import { designPixel } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { APP_EASE_OUT, FOLD_GLIDE } from "./app-motion";
import { swapIcon } from "./icon-swap";
import { RUN_CALL_KINDS, type RunCallKind, runCountText, runTitle } from "./tool-run-text";

/** FOLD_MOTION_MS of transcript-fold-motion.ts: the rows move for 280 ms after a run resizes. */
export const FOLD_MOTION = 0.28;

/** LINE_ENTER of tool-run-rows.tsx: a call that comes fades and rises 4 points in 200 ms. */
const LINE_ENTER = { rise: 4, duration: 0.2 };

/** DisclosureMarker: after a press, the chevron turns in `motion.fast`, 180 ms. */
const MARKER_TURN = 0.18;

const isKind = (value: string | undefined): value is RunCallKind =>
  RUN_CALL_KINDS.some((kind) => kind === value);

/** The steps of the tool runs in the transcript of the session screen `screen`. */
export function toolRuns(scene: Scene, screen: HTMLElement) {
  const track = must(screen, "[data-track]");
  /** The call `id`. Two runs of a screen can hold calls of one tool, so each call has its own id. */
  const callOf = (id: string): HTMLElement => {
    const calls = all(screen, `[data-call="${id}"]`);
    const [call] = calls;
    if (!call || calls.length > 1) {
      throw new Error(`The screen has ${calls.length} calls ${id}. Give each call its own id.`);
    }
    return call;
  };
  const runOf = (row: string): HTMLElement => must(screen, `[data-run][data-row="${row}"]`);
  const runOfCall = (call: HTMLElement): HTMLElement => {
    const run = call.closest("[data-run]");
    if (!(run instanceof HTMLElement)) throw new Error(`The call ${call.dataset.call} has no run.`);
    return run;
  };

  /** Writes the counts of the calls that the run shows. The name of a run stays the same. */
  const count = (run: HTMLElement): void => {
    const kinds = all(run, "[data-call]")
      .filter((call) => !call.hidden)
      .map((call) => {
        const kind = call.dataset.callKind;
        if (!isKind(kind)) throw new Error(`The call ${call.dataset.call} has no kind.`);
        return kind;
      });
    const title = must(run, ".mob-run-title").textContent;
    if (runTitle(kinds) !== title) {
      throw new Error(`The run ${run.dataset.row} changes its name from ${title} as calls come.`);
    }
    must(run, "[data-run-counts]").textContent = runCountText(kinds);
  };

  /**
   * Hides calls that come later in the first frame. Their runs show open, as a run that still gets
   * calls, and a run that shows no call yet hides until its first call comes.
   */
  const later = (...ids: string[]): void => {
    const runs = new Set(ids.map((id) => runOfCall(callOf(id))));
    for (const id of ids) callOf(id).hidden = true;
    for (const run of runs) {
      run.dataset.fold = "open";
      run.hidden = all(run, "[data-call]").every((call) => call.hidden);
      if (!run.hidden) count(run);
    }
  };

  /** Ends the call at `at`: the bars go, the icon of its tool grows in, and its run time shows. */
  const finish = (call: HTMLElement, at: number): void => {
    swapIcon(scene, must(call, "[data-call-glyph]", SVGElement), at);
    scene.at(at, () => call.removeAttribute("data-running"));
  };

  /** The call `id` runs in the first frame, in its open run. Returns the function that ends it. */
  const running = (id: string): ((end: number) => void) => {
    const call = callOf(id);
    runOfCall(call).dataset.fold = "open";
    call.toggleAttribute("data-running", true);
    return (end) => finish(call, end);
  };

  /**
   * The call `id` comes and runs until the returned function ends it. The first call of a run
   * shows with its run at once. A call that joins a run that shows fades and rises in.
   */
  const start = (id: string, at: number): ((end: number) => void) => {
    const call = callOf(id);
    const run = runOfCall(call);
    scene.at(at, () => {
      call.hidden = false;
      call.toggleAttribute("data-running", true);
      count(run);
      if (run.hidden) {
        run.hidden = false;
        return;
      }
      scene.run(
        gsap.fromTo(
          call,
          { autoAlpha: 0, y: LINE_ENTER.rise * designPixel(call) },
          {
            autoAlpha: 1,
            y: 0,
            duration: LINE_ENTER.duration,
            ease: APP_EASE_OUT,
            clearProps: "opacity,visibility,transform",
          },
        ),
      );
    });
    return (end) => finish(call, end);
  };

  /** The call `id` comes and runs for `runs` seconds. Returns the end time. */
  const call = (id: string, at: number, runs: number): number => {
    start(id, at)(at + runs);
    return at + runs;
  };

  /**
   * Glides the run and the rows over it from `shift` CSS pixels back to their place. Until the
   * glide ends, the rows under the run cover its calls. Runs in a change of `scene.at`.
   */
  const glide = (run: HTMLElement, shift: number): void => {
    const rows = [...track.children].filter(
      (row): row is HTMLElement => row instanceof HTMLElement && !row.hidden,
    );
    const pivot = rows.indexOf(run);
    const under = rows.slice(pivot + 1);
    for (const row of under) row.toggleAttribute("data-cover", true);
    scene.run(
      gsap.fromTo(
        rows.slice(0, pivot + 1),
        { y: shift },
        {
          y: 0,
          duration: FOLD_MOTION,
          ease: FOLD_GLIDE,
          clearProps: "transform",
          onComplete: () => {
            for (const row of under) row.removeAttribute("data-cover");
            if (run.dataset.fold === "folding") run.dataset.fold = "folded";
          },
        },
      ),
    );
  };

  /**
   * The run `row` folds, as the app folds a run whose calls all ended when another row follows it.
   * Its calls stay over the rows under it until those rows cover them.
   */
  const fold = (row: string, at: number): void => {
    const run = runOf(row);
    scene.at(at, () => {
      const height = must(run, "[data-run-calls]").offsetHeight;
      run.dataset.fold = "folding";
      glide(run, -height);
    });
  };

  /**
   * The reader opens the folded run `row`: the chevron turns, and the rows under the run uncover
   * its calls.
   */
  const open = (row: string, at: number): void => {
    const run = runOf(row);
    scene.at(at, () => {
      run.dataset.fold = "open";
      glide(run, must(run, "[data-run-calls]").offsetHeight);
      scene.run(
        gsap.fromTo(
          must(run, "[data-run-chevron]", SVGElement),
          { rotation: 0 },
          { rotation: 90, duration: MARKER_TURN, ease: APP_EASE_OUT, clearProps: "transform" },
        ),
      );
    });
  };

  return { later, running, start, call, fold, open };
}
