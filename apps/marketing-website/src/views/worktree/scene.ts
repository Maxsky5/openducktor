import { must } from "../../motion/dom";
import { fadeIn } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import { mountLoop } from "../../motion/loop";
import { EASE } from "../../motion/tokens";
import { pointer } from "../../replica/shell/pointer";
import { devServerPanel } from "../../replica/studio/dev-servers";
import { OPEN_IN_CHOICE } from "../../sample/worktree";

/**
 * The visitor starts the dev servers of the repository from the task tools. The host starts the
 * scripts one after the other in the task worktree, and each terminal streams its output. Then the
 * visitor reads the api log and opens the worktree in another app. The markup holds the last
 * frame: both servers run, the api terminal is open, and the Open In menu is closed.
 */
export function mountWorktree(): void {
  mountLoop(must(document, '[data-scene="worktree"]'), (scene) => {
    const root = must(scene.stage, "[data-studio]");
    const servers = devServerPanel(scene, root);
    const { panel: dev, start, tab, lines, select, setPending, setStatus, print } = servers;
    const [web, api] = servers.ids;
    if (!web || !api) throw new Error("The worktree scene needs the web and api dev servers.");
    const menu = must(root, "[data-oi-menu]");
    const choice = must(menu, `[data-oi-item="${OPEN_IN_CHOICE}"]`);
    const cursor = pointer(scene, root);

    // The split keeps its final height in pixels while it grows from the compact panel.
    const expandedHeight = dev.offsetHeight;

    // Start: the Builder is done, and no dev server runs yet.
    dev.dataset.dev = "compact";
    const compactHeight = dev.offsetHeight;
    select(web);
    for (const id of [web, api]) setStatus(id, "stopped");
    for (const line of [...lines(web), ...lines(api)]) line.hidden = true;

    const pressed = cursor.click(() => start, 0.4);
    scene.at(pressed, () => {
      must(start, "[data-start-label]").textContent = "Starting dev servers…";
      start.toggleAttribute("data-disabled", true);
    });

    // The panel expands when the first script starts. The host starts the scripts in order.
    const opened = pressed + 0.4;
    scene.at(opened, () => {
      dev.dataset.dev = "expanded";
      setPending(true);
      setStatus(web, "starting");
      scene.run(
        gsap.fromTo(
          dev,
          { flexBasis: `${compactHeight}px` },
          {
            flexBasis: `${expandedHeight}px`,
            duration: 0.55,
            ease: EASE.arrive,
            clearProps: "flexBasis",
          },
        ),
      );
    });
    scene.at(opened + 0.3, () => {
      setStatus(web, "running");
      setStatus(api, "starting");
    });
    scene.at(opened + 0.6, () => {
      setStatus(api, "running");
      setPending(false);
    });
    print(web, [
      opened + 0.1,
      opened + 0.5,
      opened + 1.05,
      opened + 1.05,
      opened + 1.1,
      opened + 1.1,
    ]);

    // The api terminal holds the lines that it wrote while the web terminal was open.
    const switched = cursor.click(() => tab(api), opened + 1.7);
    scene.at(switched, () => select(api));
    print(api, [opened + 0.35, opened + 0.8, opened + 1.2, switched + 0.6, switched + 1.4]);

    // The worktree opens in another app. The default app of the button stays the same.
    const listed = cursor.click(() => must(root, "[data-oi-trigger]"), switched + 2.1);
    scene.at(listed, () => {
      menu.hidden = false;
      scene.run(fadeIn(menu, 0.15));
    });
    const chosen = cursor.click(() => choice, listed + 0.5);
    scene.at(chosen, () => {
      menu.toggleAttribute("data-busy", true);
      choice.toggleAttribute("data-opening", true);
    });
    scene.at(chosen + 0.8, () =>
      scene.run(
        gsap.to(menu, {
          autoAlpha: 0,
          duration: 0.15,
          onComplete: () => {
            menu.hidden = true;
          },
        }),
      ),
    );
    cursor.hide(chosen + 1.3);
    scene.endAt(chosen + 3.6);
  });
}
