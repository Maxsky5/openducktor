// Chapter 1 of the release film: the mobile app. The opening dives into the phone, which shows the
// task board and starts a Builder. A Spec agent then asks a question, which the phone answers.
// Each beat plays its own scene of the package at the speed of the app. Only a pause with no
// change on the screen plays faster. The camera frames the phone, so it fills the height of the
// frame, and pushes in once on the part that matters.
import type { Framing } from "../engine/camera";
import type { Film } from "../engine/film";
import { CAPTIONS } from "./captions";
import { BEAT_TRAVEL, BESIDE, partOf, playBeat, pushTo, REST, STEPS, unionShot } from "./shots";

/** The framing of a phone: the phone fills the height of the frame. */
const PHONE: Framing = { ...BESIDE, margin: 50, maxZoom: 1.6 };
/** The framing of a part of the phone, large enough to read. */
const CLOSE: Framing = { ...BESIDE, margin: 80, maxZoom: 2 };
/** The part of the first set that the opening dives into, and its framing. */
export const FIRST = { set: "mobile-start-builder", part: "[data-phone]", framing: PHONE } as const;

/** Plays the chapter from `at`, when the camera is on the first phone. Returns its end. */
export function mobileChapter(film: Film, at: number): number {
  // The Tasks tab shows the board one lane at a time. Two swipes reach Ready for Dev, Start
  // Builder opens the start sheet, and Start session shows the startup steps of the app until the
  // session is ready and opens. The camera is already on the phone.
  const tasks = playBeat(
    film,
    {
      set: FIRST.set,
      caption: CAPTIONS.tasks.id,
      play: { mark: "swipe" },
      part: FIRST.part,
      framing: FIRST.framing,
      lead: 0.6,
      result: { mark: "session", hold: 1.1 },
      travel: 0,
    },
    at,
  );
  const start = tasks.run;
  // The lane rests for 1 s between the two swipes, and the finger shows 0.55 s before each tap.
  // The rests before the second swipe, before the tap on Start Builder, and while the visitor
  // reads the sheet play faster.
  start.speed(start.at("swipe", 1.0), REST);
  start.speed(start.at("swipe", 1.85), 1);
  start.speed(start.at("ready", 0.3), REST);
  start.speed(start.at("tap", -0.6), 1);
  start.speed(start.at("sheet", 0.15), REST);
  start.speed(start.at("start", -0.6), 1);
  // The startup steps of the new worktree play faster.
  start.speed(start.at("start", 0.45), STEPS);
  start.speed(start.at("session", -0.05), 1);
  // The session holds still once it has slid in, before the Builder adds its first rows.
  start.freeze(start.at("session", 0.25));
  const started = tasks.close();

  // A Spec agent waits in Needs you with a question. The phone opens its session, and the camera
  // pushes in on the question while the visitor reads it, picks an option, and confirms. The card
  // goes, the answer shows in the transcript, and the agent goes on.
  const question = playBeat(
    film,
    {
      set: "mobile-question",
      caption: CAPTIONS.question.id,
      play: { mark: "open" },
      part: FIRST.part,
      framing: PHONE,
      lead: 0.6,
      result: { mark: "answered", hold: 1.0 },
      travel: BEAT_TRAVEL,
    },
    started,
  );
  const part = (selector: string): (() => HTMLElement) => partOf(film, "mobile-question", selector);
  pushTo(
    film,
    unionShot(
      film,
      [part('[data-request="question"]'), part('[data-screen="session"] [data-composer]')],
      CLOSE,
    ),
    question.run.at("question", 0.2),
  );
  // The visitor reads the question while the camera pushes in. The rests before the choice and
  // before the confirm play faster.
  const ask = question.run;
  // The answer holds still: the reply of the agent comes 0.8 s after the answer, as the camera
  // leaves, so the scene stops just before it.
  ask.speed(ask.at("question", 1.4), REST);
  ask.speed(ask.at("choose", -0.6), 1);
  ask.speed(ask.at("choose", 0.25), REST);
  ask.speed(ask.at("submit", -0.6), 1);
  ask.freeze(ask.at("answered", 0.75));
  return question.close();
}
