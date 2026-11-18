// Chapter 5 of the release film: GitLab. A repository connects to GitLab with Detect from origin
// and the browser sign-in, and the card shows Ready. Each step plays at the speed of the app. Only
// the wait for the sign-in in the browser plays faster.
import type { Framing } from "../engine/camera";
import type { Film } from "../engine/film";
import { CAPTIONS } from "./captions";
import { BESIDE, CHAPTER_TRAVEL, POINTER, partOf, playBeat, pushTo, REST, shotOf } from "./shots";

/** The framing of the whole settings tab. */
const WINDOW: Framing = { ...BESIDE, maxZoom: 1 };
/** The framing of the GitLab card that the camera pushes in on. */
const CLOSE: Framing = { ...BESIDE, maxZoom: 1.45 };

/** Plays the chapter from `at`. Returns the time when it ends. */
export function gitlabChapter(film: Film, at: number): number {
  // The Git tab of the repository: GitLab, then Detect from origin, then the browser sign-in, and
  // the card shows Ready. The camera pushes in on the GitLab card when it fills.
  const gitlab = playBeat(
    film,
    {
      set: "gitlab",
      caption: CAPTIONS.gitlab.id,
      play: { mark: "provider" },
      part: ".gl-content",
      framing: WINDOW,
      lead: 0.3,
      result: { mark: "ready", hold: 0.9 },
      travel: CHAPTER_TRAVEL,
    },
    at,
  );
  const sign = gitlab.run;
  // The push lands before the click on Detect from origin.
  pushTo(
    film,
    shotOf(film, partOf(film, "gitlab", "[data-gitlab-card]"), CLOSE),
    sign.at("provider", 0.4),
    0.9,
  );
  // Detect from origin spins for 0.9 s, and its wait plays faster. The rest after the path fills
  // plays faster, and the pointer goes faster to Sign in with GitLab, 1.4 s before the wait for the
  // browser. The visitor approves the sign-in in the browser: that wait plays faster too.
  sign.speed(sign.at("provider", 1.85), 2);
  sign.speed(sign.at("detected", -0.05), 1);
  sign.speed(sign.at("detected", 0.1), REST);
  sign.speed(sign.at("waiting", -1.45), POINTER);
  sign.speed(sign.at("waiting", -0.6), 1);
  sign.speed(sign.at("waiting", 0.3), REST);
  sign.speed(sign.at("ready", -0.35), 1);
  return gitlab.close();
}
