import { must } from "../../motion/dom";
import { gsap } from "../../motion/gsap";
import { mountLoop } from "../../motion/loop";
import { EASE } from "../../motion/tokens";
import {
  addCard,
  boardOf,
  moveCard,
  openLane,
  scrollBoardTo,
  swapIn,
} from "../../replica/board/board";
import { pointer } from "../../replica/shell/pointer";
import { countActivity } from "../../replica/shell/sidebar";
import { notify } from "../../replica/shell/toast";
import type { HeroTemplate } from "./templates";

/**
 * The opening board. The tasks move through the workflow: a planner starts, a build reaches QA,
 * QA passes a task to human review, a merged pull request closes a task, and a session waits for
 * an answer. The markup holds the first frame, because this view shows when the page opens.
 */
export function mountHero(): void {
  mountLoop<HeroTemplate>(must(document, '[data-scene="hero"]'), (scene) => {
    const root = must(scene.stage, "[data-root]");
    const toasts = must(scene.stage, "[data-toasts]");
    const { track, lane, body, card, running } = boardOf(scene);
    const actions = (name: string): HTMLElement => must(card(name), "[data-card-actions]");
    const cursor = pointer(scene, root);
    const action = (name: string) => (): HTMLElement => must(card(name), "[data-card-action]");

    // 1. You start the Planner on a specified feature.
    scrollBoardTo(scene, track, lane("spec_ready"), 0.4);
    const planClick = cursor.click(action("titles"), 1.1, 1);
    swapIn(scene, actions("titles"), "planner-starting", planClick + 0.1);
    running(card("titles"), true, planClick + 0.1);
    countActivity(scene, root, "sessions", 4, planClick + 0.15);
    swapIn(scene, actions("titles"), "planner-running", planClick + 0.9);
    cursor.hide(planClick + 0.6);

    // 2. A build finishes. The task moves to AI Review and you request the QA review.
    const built = planClick + 1.5;
    running(card("shortcut"), false, built);
    swapIn(scene, actions("shortcut"), "request-qa", built);
    countActivity(scene, root, "sessions", 3, built);
    notify(scene, toasts, "toast-qa", built + 0.1, 3.4);
    scrollBoardTo(scene, track, lane("ai_review"), built + 0.3, 0.9);
    const landed = moveCard(scene, card("shortcut"), body("ai_review"), built + 1.1);
    const qaClick = cursor.click(action("shortcut"), landed + 0.1, 0.9);
    swapIn(scene, actions("shortcut"), "qa-starting", qaClick + 0.1);
    running(card("shortcut"), true, qaClick + 0.1);
    countActivity(scene, root, "sessions", 4, qaClick + 0.15);
    swapIn(scene, actions("shortcut"), "qa-running", qaClick + 0.8);
    cursor.hide(qaClick + 0.5);

    // 3. QA approves another task. It moves to Human Review.
    const approved = qaClick + 1.4;
    running(card("focus"), false, approved);
    swapIn(scene, actions("focus"), "approve", approved);
    countActivity(scene, root, "sessions", 3, approved);
    notify(scene, toasts, "toast-review", approved + 0.1, 3.4);
    scrollBoardTo(scene, track, lane("human_review"), approved + 0.3, 0.9);
    const reviewed = moveCard(scene, card("focus"), body("human_review"), approved + 1.1);

    // 4. The pull request of a reviewed task merges. The task closes by itself.
    const merged = reviewed + 0.5;
    const badge = scene.template("merged");
    scene.at(merged, () => {
      must(card("typing"), "[data-pr-badge]").replaceWith(badge);
      scene.run(gsap.fromTo(badge, { scale: 0.7 }, { scale: 1, duration: 0.4, ease: EASE.snap }));
    });
    scrollBoardTo(scene, track, lane("closed"), merged + 0.5, 0.9);
    const opened = openLane(scene, lane("closed"), merged + 0.5);
    scrollBoardTo(scene, track, lane("closed"), opened, 0.5);
    const closed = moveCard(scene, card("typing"), body("closed"), opened + 0.2);
    swapIn(scene, actions("typing"), "open-builder", closed - 0.1);
    notify(scene, toasts, "toast-closed", closed - 0.2, 3);

    // 5. A new task arrives in the backlog while a Builder waits for an answer.
    scrollBoardTo(scene, track, lane("open"), closed + 0.6, 1.1);
    addCard(scene, body("open"), scene.template("new-task"), closed + 1.6);
    notify(scene, toasts, "toast-input", closed + 2.4, 3.6);
    countActivity(scene, root, "waiting", 1, closed + 2.5);
    scene.endAt(closed + 6.9);
  });
}
