// Chapter 1 of the release film: the mobile app. The opening dives into Remote control on the
// computer, which shows a QR code, and the phone scans it and connects. The phone then shows the
// task board and starts a Builder, and a Spec agent asks a question, which the phone answers.
// Each beat plays its own scene of the package at the speed of the app. Only the rests with no
// change on the screen and the startup steps play faster. The camera frames the phone, so it fills
// the height of the frame, and pushes in once on the part that matters.
import type { Framed, Framing } from "../engine/camera";
import type { Film } from "../engine/film";
import { CAPTIONS } from "./captions";
import {
  BEAT_TRAVEL,
  BESIDE,
  partOf,
  playBeat,
  REST,
  STEPS,
  shotOf,
  TRAVEL_EASE,
  unionShot,
} from "./shots";

/** The framing of a phone: the phone fills the height of the frame. */
const PHONE: Framing = { ...BESIDE, margin: 50, maxZoom: 1.6 };
/** The framing of a part of the phone, large enough to read. */
const CLOSE: Framing = { ...BESIDE, margin: 80, maxZoom: 2 };
/** Seconds of the push in on the question. */
const PUSH = 1.1;
/** The framing of the computer and the phone of the pairing, side by side. */
const PAIR: Framing = { ...BESIDE, margin: 60, maxZoom: 1.2 };
/**
 * How much slower the rest on the QR code plays, before the finger comes to the phone: the viewer
 * sees the code, and the camera reaches the phone before the tap.
 */
const QR_REST = 0.4;
/** The set that the opening dives into. */
export const FIRST_SET = "mobile-pair";

/** The first shot of the chapter: Remote control on the computer and the phone, side by side. */
export const firstShot = (film: Film): (() => Framed) =>
  unionShot(
    film,
    [partOf(film, FIRST_SET, "[data-stage-lead]"), partOf(film, FIRST_SET, "[data-phone]")],
    PAIR,
  );

/** Plays the chapter from `at`, when the camera is on the first shot. Returns its end. */
export function mobileChapter(film: Film, at: number): number {
  // Add device opens the pairing window, and Scan a QR code shows the code. The camera then goes
  // to the phone, which scans the code, connects, and opens its sessions. The wait for the host
  // plays faster.
  const pair = playBeat(
    film,
    {
      set: FIRST_SET,
      caption: CAPTIONS.pair.id,
      mark: "add-device",
      shot: firstShot(film),
      lead: 0.5,
      result: { mark: "paired", hold: 1.4 },
      travel: 0,
    },
    at,
  );
  const scan = pair.run;
  scan.speed("qr", QR_REST);
  scan.speed("qr-rest-end", 1);
  scan.speed("connect", STEPS);
  scan.speed("paired", 1);
  film.camera.move(
    shotOf(film, partOf(film, FIRST_SET, "[data-phone]"), PHONE),
    scan.mark("qr") + 0.6,
    BEAT_TRAVEL,
    TRAVEL_EASE,
  );
  const paired = pair.close();

  // The Tasks tab shows the board one lane at a time. Two swipes reach Ready for Dev, Start
  // Builder opens the start sheet, and Start session shows the startup steps of the app until the
  // session is ready and opens.
  const tasks = playBeat(
    film,
    {
      set: "mobile-start-builder",
      caption: CAPTIONS.tasks.id,
      mark: "swipe",
      part: "[data-phone]",
      framing: PHONE,
      lead: 0.6,
      result: { mark: "session", hold: 1.1 },
      travel: BEAT_TRAVEL,
    },
    paired,
  );
  // The rests of the board, of the card, and of the sheet play faster, and so do the startup
  // steps of the new worktree. The session then holds still once it has slid in, before the
  // Builder adds its first rows.
  const start = tasks.run;
  start.speed("lane-rest", REST);
  start.speed("lane-rest-end", 1);
  start.speed("card-rest", REST);
  start.speed("card-rest-end", 1);
  start.speed("sheet-rest", REST);
  start.speed("sheet-rest-end", 1);
  start.speed("startup", STEPS);
  start.speed("startup-end", 1);
  start.freeze(start.mark("session-in"));
  const started = tasks.hideCaption();

  // A Spec agent waits in Needs you with a question. The phone opens its session, and the camera
  // pushes in on the question while the visitor reads it, picks an option, and confirms. The card
  // goes, the answer shows in the transcript, and the agent goes on.
  const question = playBeat(
    film,
    {
      set: "mobile-question",
      caption: CAPTIONS.question.id,
      mark: "open",
      part: "[data-phone]",
      framing: PHONE,
      lead: 0.6,
      result: { mark: "answered", hold: 1.0 },
      travel: BEAT_TRAVEL,
    },
    started,
  );
  const part = (selector: string): (() => HTMLElement) => partOf(film, "mobile-question", selector);
  const ask = question.run;
  film.camera.move(
    unionShot(
      film,
      [part('[data-request="question"]'), part('[data-screen="session"] [data-composer]')],
      CLOSE,
    ),
    ask.mark("read"),
    PUSH,
  );
  // The rests before the choice and before the confirm play faster. The answer then holds still:
  // the scene stops before the reply of the agent, as the camera leaves.
  ask.speed("read-rest", REST);
  ask.speed("read-rest-end", 1);
  ask.speed("choice-rest", REST);
  ask.speed("choice-rest-end", 1);
  ask.freeze(ask.mark("before-reply"));
  return question.hideCaption();
}
