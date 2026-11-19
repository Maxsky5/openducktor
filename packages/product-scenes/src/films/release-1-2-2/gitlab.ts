// Chapter 5 of the release film: GitLab. A repository connects to GitLab with Detect from origin
// and the browser sign-in, and the card shows Ready. Each step plays at the speed of the app. Only
// the waits play faster: the detection, a rest, a travel of the pointer, and the approval of the
// sign-in in the browser.
import type { Framing } from "../engine/camera";
import type { Film } from "../engine/film";
import { CAPTIONS } from "./captions";
import { BESIDE, CHAPTER_TRAVEL, POINTER, partOf, playBeat, REST, shotOf } from "./shots";

/** The framing of the whole settings tab. */
const WINDOW: Framing = { ...BESIDE, maxZoom: 1 };
/** The framing of the GitLab card that the camera pushes in on. */
const CLOSE: Framing = { ...BESIDE, maxZoom: 1.45 };
/** How much faster the spinner of Detect from origin plays while it reads the origin remote. */
const DETECT = 2;

/** Plays the chapter from `at`. Returns the time when it ends. */
export function gitlabChapter(film: Film, at: number): number {
  // The Git tab of the repository: GitLab, then Detect from origin, then the browser sign-in, and
  // the card shows Ready. The camera pushes in on the GitLab card when it fills.
  const gitlab = playBeat(
    film,
    {
      set: "gitlab",
      caption: CAPTIONS.gitlab.id,
      mark: "provider",
      part: "[data-tab]",
      framing: WINDOW,
      lead: 0.3,
      result: { mark: "ready", hold: 0.9 },
      travel: CHAPTER_TRAVEL,
    },
    at,
  );
  const sign = gitlab.run;
  // The push lands before the click on Detect from origin.
  film.camera.move(
    shotOf(film, partOf(film, "gitlab", "[data-gitlab-card]"), CLOSE),
    sign.mark("gitlab-card"),
    0.9,
  );
  // The wait of Detect from origin plays faster, and so does the rest after the path fills. The
  // pointer goes faster to Sign in with GitLab. The visitor approves the sign-in in the browser:
  // that wait plays faster too.
  sign.speed("detect", DETECT);
  sign.speed("detect-end", 1);
  sign.speed("detected-rest", REST);
  sign.speed("to-sign-in", POINTER);
  sign.speed("to-sign-in-end", 1);
  sign.speed("approval", REST);
  sign.speed("approval-end", 1);
  return gitlab.close();
}
