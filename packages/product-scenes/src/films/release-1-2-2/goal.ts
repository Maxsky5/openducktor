// Chapter 2 of the release film: Goal mode. The start dialog of the Builder turns Goal mode on, a
// model writes the goal, and the session starts. The Builder then works turn after turn by itself,
// and the goal row shows Complete. Each step of the UI plays at the speed of the app. The rests,
// the travels of the pointer, the wait for the model, and the startup steps play faster, and the
// work of the Builder plays as a time lapse.
import type { Framing, Shot } from "../engine/camera";
import type { Film } from "../engine/film";
import { CAPTIONS } from "./captions";
import { BESIDE, CHAPTER_TRAVEL, POINTER, partOf, playBeat, REST } from "./shots";
import { FRAME } from "./view";

/** The framing of the dialog: it shows large next to the captions. */
const DIALOG: Framing = { ...BESIDE, maxZoom: 1.5 };
/** The start dialog at its largest, with Goal mode on: 672 px wide, as in StartDialog.css. */
const DIALOG_SIZE = { width: 672, height: 700 } as const;
/** The zoom of the chat column of the session: the whole column fits the height of the frame. */
const CHAT_ZOOM = 1.2;
/** How much faster the Builder works while its turns play as a time lapse. */
const LAPSE = 2.5;
/**
 * How much faster the startup steps play. The camera still lands on the chat before the session
 * opens.
 */
const STARTUP = 1.6;
/** Seconds of the camera move to the chat column. */
const TO_CHAT = 0.9;
/** How much faster the wait for the model that writes the goal plays. The spinner keeps its speed. */
const MODEL_WAIT = 3;

/** Plays the chapter from `at`. Returns the time when the last beat ends. */
export function goalChapter(film: Film, at: number): number {
  const { camera, captions } = film;
  const part = (selector: string): (() => HTMLElement) => partOf(film, "goal-mode", selector);

  // The camera frames the place of the start dialog of the Builder, which opens after the camera
  // has arrived. The dialog sits in the center of the window, so it grows around its center when
  // Goal mode turns on, and one framing holds it at both sizes. Generate goal waits for the model,
  // which writes a sharper goal, and Start session shows the startup steps.
  const place = (): Shot => {
    const window = camera.boxOf(part("[data-root]")());
    return camera.frame(
      {
        x: window.x + (window.width - DIALOG_SIZE.width) / 2,
        y: window.y + (window.height - DIALOG_SIZE.height) / 2,
        ...DIALOG_SIZE,
      },
      DIALOG,
    );
  };
  const start = playBeat(
    film,
    {
      set: "goal-mode",
      caption: CAPTIONS.goalStart.id,
      mark: "dialog",
      shot: place,
      lead: 0.05,
      result: { mark: "start", hold: 0.6 },
      travel: CHAPTER_TRAVEL,
    },
    at,
  );
  const run = start.run;
  // The rest after the switch and the travel of the pointer to Generate goal play faster, and so
  // does the wait for the model. The visitor sees the new goal, and the rest and the travel of the
  // pointer to Start session play faster.
  run.speed("goal-on-rest", REST);
  run.speed("to-generate", POINTER);
  run.speed("to-generate-end", 1);
  run.speed("model", MODEL_WAIT);
  run.speed("model-end", 1);
  run.speed("generated-rest", REST);
  run.speed("to-start", POINTER);
  run.speed("to-start-end", 1);
  const started = start.hideCaption();

  // While the dialog shows the startup steps, the camera moves to the chat column, where the
  // Builder session opens. The column ends at the right edge of the frame, so the side panel of
  // the window stays out of the frame and no text is cut. The turns play as a time lapse, and the
  // goal row at the bottom of the column shows Complete at the speed of the app.
  const chat = (): Shot => {
    const box = camera.boxOf(part("[data-studio-main]")());
    return {
      x: box.x + box.width - FRAME.width / 2 / CHAT_ZOOM,
      y: box.y + box.height / 2,
      zoom: CHAT_ZOOM,
    };
  };
  // The camera leaves while the dialog resizes to the startup steps, and the steps play faster. The
  // camera lands before the dialog goes and the session shows.
  run.speed("startup", STARTUP);
  run.speed("startup-end", 1);
  camera.move(chat, run.mark("resizing"), TO_CHAT);
  captions.show(CAPTIONS.goalTurns.id, started + 0.45);
  run.speed("turns", LAPSE);
  run.speed("turns-end", 1);
  const complete = run.mark("complete");
  const end = complete + 1.0;
  captions.hide(CAPTIONS.goalTurns.id, end - 0.2);
  run.freeze(end);
  return end;
}
