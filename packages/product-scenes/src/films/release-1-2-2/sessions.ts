// Chapter 3 of the release film: sessions. A session forks from a reply, and the fork opens with
// the conversation up to that reply. Each step plays at the speed of the app. Only the travels and
// the rest of the pointer and the startup steps play faster.
import type { Framing, Shot } from "../engine/camera";
import type { Film } from "../engine/film";
import { CAPTIONS } from "./captions";
import { BESIDE, CHAPTER_TRAVEL, POINTER, partOf, playBeat, REST, STEPS, shotOf } from "./shots";

/**
 * The framing of the whole window. The Fork session dialog opens in the center of the window, over
 * the sidebar and the chat, so a closer framing would cut the dialog or the result.
 */
const WINDOW: Framing = { ...BESIDE, maxZoom: 1 };
/** The framing of the first reply, so the tooltip of its fork button reads. */
const REPLY: Framing = { ...BESIDE, margin: 140, maxZoom: 1.5 };
/** The first reply of the source session, which the visitor forks. */
const FIRST_REPLY = '[data-page="source"] [data-row="first-reply"]';
/**
 * Pixels of the frame that the first shot moves the window to the left, so the edge of the sidebar
 * sits under the caption column, where its cut labels fade, and the reply stays whole.
 */
const SIDEBAR_SHIFT = 70;
/** How much faster the pointer goes to the worktree name, where it only rests. */
const NAME = 2.5;

/** Plays the chapter from `at`. Returns the time when it ends. */
export function sessionsChapter(film: Film, at: number): number {
  // The visitor forks the session from its first reply. The camera starts on the reply, where the
  // tooltip names the action, and takes the whole window when the dialog opens. The dialog offers
  // the same folder or a new worktree, and the fork opens with the separator after the copied turn
  // and shows in the sidebar next to its source.
  const fork = playBeat(
    film,
    {
      set: "fork",
      caption: CAPTIONS.fork.id,
      mark: "point",
      shot: (): Shot => {
        const shot = shotOf(film, partOf(film, "fork", FIRST_REPLY), REPLY)();
        return { ...shot, x: shot.x + SIDEBAR_SHIFT / shot.zoom };
      },
      lead: 0.8,
      result: { mark: "forked", hold: 1.3 },
      travel: CHAPTER_TRAVEL,
    },
    at,
  );
  const run = fork.run;
  // The pointer goes fast to the worktree name, and its rest there plays faster. It then goes
  // faster to Fork session. Once the dialog has narrowed to the startup progress, its steps play
  // twice as fast; each step still shows.
  run.speed("to-name", NAME);
  run.speed("name-rest", REST);
  run.speed("to-confirm", POINTER);
  run.speed("to-confirm-end", 1);
  run.speed("startup", STEPS);
  run.speed("startup-end", 1);
  film.camera.move(
    shotOf(film, partOf(film, "fork", "[data-root]"), WINDOW),
    run.mark("dialog-open"),
    0.7,
  );
  // The fork holds still once its dialog has closed, before the pointer goes on to the composer.
  run.freeze(run.mark("dialog-closed"));
  return fork.hideCaption();
}
