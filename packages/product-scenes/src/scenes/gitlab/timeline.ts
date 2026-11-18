import { must } from "../../motion/dom";
import { designPixel } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import type { Scene, SceneBuilder } from "../../motion/scene";
import { EASE } from "../../motion/tokens";
import { gitSettings } from "../../replicas/settings/git-settings";
import { pointer } from "../../replicas/shell/cursor";
import { INSTANCE_URL, PROJECT_PATH } from "./sample";

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
 * Scrolls the Git tab `tab` from `at` as far as the element of `find` must move to show in full. A
 * tab that shows it already stays, as on a wide stage. Returns the end of the scroll.
 */
function reveal(scene: Scene, tab: HTMLElement, find: () => HTMLElement, at: number): number {
  scene.at(at, () => {
    // The rectangles include the scale of the stage, and the scroll offset does not.
    const view = tab.getBoundingClientRect();
    const scale = view.height / tab.offsetHeight;
    const below = (find().getBoundingClientRect().bottom - view.bottom) / scale;
    const distance = below + SCROLL_MARGIN * designPixel(tab);
    if (distance <= 0) return;
    scene.run(
      gsap.to(tab, { scrollTop: tab.scrollTop + distance, duration: SCROLL, ease: EASE.move }),
    );
  });
  return at + SCROLL;
}

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
  git.reset(INSTANCE_URL);

  // The visitor selects GitLab. The card shows at once and asks to link the project, and the empty
  // Project path shows its error.
  const picked = cursor.click(() => git.tile("gitlab"), 0.5, 1);
  git.select("gitlab", picked);
  scene.mark("provider", picked);

  // Detect from origin reads the origin remote and fills the project path. The error goes, and the
  // card asks for an account.
  const clicked = cursor.click(git.detectButton, picked + 0.9, 0.9);
  const detected = git.detect(PROJECT_PATH, clicked, DETECT);
  git.readiness("connect", detected);
  scene.mark("detected", detected);

  // Sign in with GitLab opens the sign-in in the browser, and the card waits for the approval. A
  // phone stage scrolls the tab to the button first.
  const revealed = reveal(scene, tab, git.signInButton, detected + 0.4);
  const signedIn = cursor.click(git.signInButton, revealed + 0.1, 0.8);
  const waiting = git.startSignIn(signedIn, SIGN_IN);
  scene.mark("waiting", waiting);
  cursor.hide(waiting + 0.4);

  // The visitor approves the sign-in in the browser. The account links, and the card is Ready.
  const ready = git.link(waiting + APPROVAL, CHECK);
  scene.mark("ready", ready);
  scene.endAt(ready + 2.5);
};
