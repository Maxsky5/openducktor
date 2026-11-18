// Chapter 4 of the release film: task artifacts. The Builder saves an HTML mockup on the task, the
// mockup joins the files of the Artifacts tab, and the visitor opens it in a large preview. Each
// step plays at the speed of the app.
import type { Framing, Shot } from "../engine/camera";
import type { Film } from "../engine/film";
import { CAPTIONS } from "./captions";
import { BESIDE, CHAPTER_TRAVEL, POINTER, partOf, playBeat, pushTo, REST } from "./shots";

/** The framing of the whole window. */
const WINDOW: Framing = { ...BESIDE, maxZoom: 1 };
/** The framing of the mockup in the large preview: it fills most of the height of the frame. */
const MOCKUP: Framing = { ...BESIDE, maxZoom: 1.9 };

/** Plays the chapter from `at`. Returns the time when it ends. */
export function artifactsChapter(film: Film, at: number): number {
  const beat = playBeat(
    film,
    {
      set: "artifacts",
      caption: CAPTIONS.artifacts.id,
      play: { mark: "saved" },
      part: ".af-window",
      framing: WINDOW,
      lead: 0.4,
      result: { mark: "preview", hold: 1.9 },
      travel: CHAPTER_TRAVEL,
    },
    at,
  );
  // The pointer goes to the saved file a little faster. The rests after the file opens and on the
  // Expand button play faster.
  const run = beat.run;
  run.speed(run.at("said", 0.05), REST);
  run.speed(run.at("said", 0.4), POINTER);
  run.speed(run.at("file", -0.36), 1);
  run.speed(run.at("file", 0.5), REST);
  run.speed(run.at("file", 1.15), 1);
  run.speed(run.at("expand", 0.25), REST);
  run.speed(run.at("expand", 0.6), 1);
  // The large preview opens, and the camera pushes in on the page that the Builder made, with the
  // title of the file above it. The title starts at the left edge of the dialog, and the empty
  // right part of the title bar may leave the frame.
  const preview = (selector: string): HTMLElement =>
    partOf(film, "artifacts", `.ar-dialog ${selector}`)();
  pushTo(
    film,
    (): Shot => {
      const head = film.camera.boxOf(preview(".ar-dialog-head"));
      const page = film.camera.boxOf(preview(".wf-sheet"));
      return film.camera.frame(
        {
          x: head.x,
          y: head.y,
          width: page.x + page.width - head.x,
          height: page.y + page.height - head.y,
        },
        MOCKUP,
      );
    },
    run.at("preview", 0.2),
    0.7,
  );
  return beat.close();
}
