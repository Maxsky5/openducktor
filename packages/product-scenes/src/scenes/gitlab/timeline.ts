import { must } from "../../motion/dom";
import { designPixel, revealTween } from "../../motion/effects";
import type { SceneBuilder } from "../../motion/scene";
import { gitSettings } from "../../replicas/settings/git-settings";
import { pointer } from "../../replicas/shell/cursor";
import { PROJECT_PATH } from "./sample";

/** Seconds that Detect from origin takes to read the origin remote. */
const DETECT = 0.9;

/** Seconds of the spinner of Sign in with GitLab before the one-time code shows. */
const SIGN_IN = 0.6;

/** Seconds that the visitor takes to approve the sign-in in the browser. */
const APPROVAL = 2.4;

/** Seconds that the app checks the new connection. */
const CHECK = 1;

/** Seconds of a scroll of the Git tab. */
const SCROLL = 0.6;

/** The room under an element that a scroll shows, in design pixels. */
const SCROLL_MARGIN = 16;

/**
 * The visitor connects the repository to GitLab. GitLab shows its setup card, and the empty Project
 * path shows its error. Detect from origin fills the project, and Sign in with GitLab shows the
 * one-time code while the browser asks for the approval. The account links, the app checks it, and
 * the card is Ready. Each change shows at once, as in the app. The markup holds the last frame.
 */
export const build: SceneBuilder = (scene) => {
  const root = must(scene.stage, "[data-root]");
  const tab = must(root, "[data-tab]");
  const git = gitSettings(scene, root);
  const cursor = pointer(scene, root);

  // Start: the repository has no provider.
  git.reset();

  // The visitor selects GitLab. The card shows at once and asks to link the project, and the empty
  // Project path shows its error.
  const picked = cursor.click(() => git.tile("gitlab"), 0.5, 1);
  git.select("gitlab", picked);
  scene.mark("provider", picked);
  scene.mark("gitlab-card", picked + 0.4);
  // The marks of each wait keep a short margin to the changes of the screen, so a film can play the
  // wait faster: the detection, the rest, the travel of the pointer, and the approval.
  scene.mark("detect", picked + 1.85);

  // Detect from origin reads the origin remote and fills the project path. The error goes, and the
  // card asks for an account.
  const clicked = cursor.click(git.detectButton, picked + 0.9, 0.9);
  const detected = git.detect(PROJECT_PATH, clicked, DETECT);
  scene.mark("detected", detected);
  scene.mark("detect-end", detected - 0.05);
  scene.mark("detected-rest", detected + 0.1);

  // Sign in with GitLab opens the sign-in in the browser, and the card waits for the approval. A
  // phone stage scrolls the tab to show the button first. A wide stage shows it already.
  const revealing = detected + 0.4;
  scene.at(revealing, () => {
    const margin = SCROLL_MARGIN * designPixel(tab);
    const scroll = revealTween(tab, git.signInButton(), margin, SCROLL);
    if (scroll) scene.run(scroll);
  });
  const revealed = revealing + SCROLL;
  const signedIn = cursor.click(git.signInButton, revealed + 0.1, 0.8);
  const waiting = git.startSignIn(signedIn, SIGN_IN);
  scene.mark("waiting", waiting);
  scene.mark("to-sign-in", waiting - 1.45);
  scene.mark("to-sign-in-end", waiting - 0.6);
  scene.mark("approval", waiting + 0.3);
  cursor.hide(waiting + 0.4);

  // The visitor approves the sign-in in the browser. The account links, and the card is Ready.
  const ready = git.link(waiting + APPROVAL, CHECK);
  scene.mark("ready", ready);
  scene.mark("approval-end", ready - 0.35);
  scene.endAt(ready + 2.5);
};
