import { must } from "../../motion/dom";
import { fadeIn } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import { mountLoop } from "../../motion/loop";
import { EASE } from "../../motion/tokens";
import { pointer } from "../../replica/shell/pointer";
import { bottomPanel } from "../../replica/studio/terminals";
import { OPEN_IN_CHOICE } from "../../sample/worktree";

/**
 * The visitor runs the repository actions of the top bar in the task worktree. The default
 * action runs from its button, and another action runs from the menu. Each run opens a new
 * terminal in the bottom panel, and the host prints each command line before the shell runs it.
 * Then the visitor opens the worktree in another app. The markup holds the last frame.
 */
export function mountActions(): void {
  mountLoop(must(document, '[data-scene="actions"]'), (scene) => {
    const root = must(scene.stage, "[data-studio]");
    const terminals = bottomPanel(scene, root);
    const menu = must(root, "[data-repo-menu]");
    const openMenu = must(root, "[data-oi-menu]");
    const choice = must(openMenu, `[data-oi-item="${OPEN_IN_CHOICE}"]`);
    const cursor = pointer(scene, root);
    /** A popover scales in, as popover.css does. */
    const popIn = (element: HTMLElement): gsap.core.Tween =>
      gsap.fromTo(
        element,
        { autoAlpha: 0, scale: 0.97 },
        { autoAlpha: 1, scale: 1, duration: 0.25, ease: EASE.arrive, clearProps: "transform" },
      );

    // Start: the Builder is done, and no terminal runs.
    terminals.close();

    // The visitor runs the default action. The bottom panel opens with its terminal.
    const ran = cursor.click(() => must(root, "[data-repo-run]"), 0.5);
    terminals.open(ran + 0.05);
    terminals.run("web", ran + 0.1);
    terminals.print("web", [ran + 0.15, ran + 0.5, ran + 0.9, ran + 0.9, ran + 1, ran + 1]);

    // The menu lists the other actions. API runs in a second terminal.
    const listed = cursor.click(() => must(root, "[data-repo-more]"), ran + 1.6, 0.6);
    scene.at(listed, () => {
      menu.hidden = false;
      scene.run(popIn(menu));
    });
    const picked = cursor.click(() => must(menu, '[data-repo-item="api"]'), listed + 0.5, 0.6);
    scene.at(picked, () =>
      must(menu, '[data-repo-item="api"]').toggleAttribute("data-active", true),
    );
    scene.at(picked + 0.15, () => {
      menu.hidden = true;
      must(menu, '[data-repo-item="api"]').removeAttribute("data-active");
    });
    terminals.run("api", picked + 0.2);
    terminals.print("api", [picked + 0.25, picked + 0.6, picked + 1, picked + 1.8, picked + 2.5]);

    // The worktree opens in another app. The default app of the button stays the same.
    const opened = cursor.click(() => must(root, "[data-oi-trigger]"), picked + 3.1);
    scene.at(opened, () => {
      openMenu.hidden = false;
      scene.run(fadeIn(openMenu, 0.15));
    });
    const chosen = cursor.click(() => choice, opened + 0.5);
    scene.at(chosen, () => {
      openMenu.toggleAttribute("data-busy", true);
      choice.toggleAttribute("data-opening", true);
    });
    scene.at(chosen + 0.8, () =>
      scene.run(
        gsap.to(openMenu, {
          autoAlpha: 0,
          duration: 0.15,
          onComplete: () => {
            openMenu.hidden = true;
          },
        }),
      ),
    );
    cursor.hide(chosen + 1.3);
    scene.endAt(chosen + 3.6);
  });
}
