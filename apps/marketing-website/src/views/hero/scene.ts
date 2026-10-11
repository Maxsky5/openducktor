import { must } from "../../motion/dom";
import { designPixel, shrinkOut } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import { mountLoop } from "../../motion/loop";
import { offsetIn } from "../../motion/offset";
import { EASE } from "../../motion/tokens";
import {
  addCard,
  boardOf,
  moveCard,
  openLane,
  scrollBoardTo,
  setActivity,
  swapIn,
} from "../../replica/board/board";
import { pointer } from "../../replica/shell/pointer";
import { sessionList } from "../../replica/shell/sidebar";
import { notify } from "../../replica/shell/toast";
import { answerHere } from "../../replica/transcript/reply";
import { WAITING_QUESTION } from "../../sample/question";
import { HERO_NAV } from "./sessions";
import type { HeroTemplate } from "./templates";

/**
 * The opening board. The tasks move through the workflow: a planner starts, a build reaches QA,
 * QA passes a task to human review, a merged pull request closes a task, and a Builder stops to
 * ask a question. The sidebar regroups each session as its state changes. The visitor answers the
 * question in the session preview of the sidebar, and the Builder goes back to work. A stage
 * without the sidebar ends on the question. The markup holds the first frame, because this view
 * shows when the page opens.
 */
export function mountHero(): void {
  mountLoop<HeroTemplate>(must(document, '[data-scene="hero"]'), (scene) => {
    const root = must(scene.stage, "[data-root]");
    const toasts = must(scene.stage, "[data-toasts]");
    const { track, lane, body, card, running } = boardOf(scene);
    const actions = (name: string): HTMLElement => must(card(name), "[data-card-actions]");
    const cursor = pointer(scene, root);
    const action = (name: string) => (): HTMLElement => must(card(name), "[data-card-action]");
    const sessions = sessionList(scene, root);
    sessions.place(HERO_NAV.entries);
    /** A session ends while you look at the board, so the sidebar marks it unread. */
    const settled = { running: false, unread: true, tone: "done", time: "now" } as const;

    // 1. You start the Planner on a specified feature. The sidebar groups the sessions by task,
    // so the Planner session takes the place of the Spec session, at the top of Running.
    scrollBoardTo(scene, track, lane("spec_ready"), 0.4);
    const planClick = cursor.click(action("titles"), 1.1, 1);
    swapIn(scene, actions("titles"), "planner-starting", planClick + 0.1);
    running(card("titles"), true, planClick + 0.1);
    sessions.hide("titles-spec", planClick + 0.15);
    sessions.update("titles-planner", planClick + 0.15);
    swapIn(scene, actions("titles"), "planner-running", planClick + 0.9);
    cursor.hide(planClick + 0.6);

    // 2. A build finishes. The task moves to AI Review and you request the QA review.
    const built = planClick + 1.5;
    running(card("shortcut"), false, built);
    swapIn(scene, actions("shortcut"), "request-qa", built);
    sessions.update("shortcut-build", built, { ...settled, status: "ai_review" });
    notify(scene, toasts, "toast-qa", built + 0.1, 3.4);
    scrollBoardTo(scene, track, lane("ai_review"), built + 0.3, 0.9);
    const landed = moveCard(scene, card("shortcut"), body("ai_review"), built + 1.1);
    const qaClick = cursor.click(action("shortcut"), landed + 0.1, 0.9);
    swapIn(scene, actions("shortcut"), "qa-starting", qaClick + 0.1);
    running(card("shortcut"), true, qaClick + 0.1);
    sessions.hide("shortcut-build", qaClick + 0.15);
    sessions.update("shortcut-qa", qaClick + 0.15);
    swapIn(scene, actions("shortcut"), "qa-running", qaClick + 0.8);
    cursor.hide(qaClick + 0.5);

    // 3. QA approves another task. It moves to Human Review.
    const approved = qaClick + 1.4;
    running(card("focus"), false, approved);
    swapIn(scene, actions("focus"), "approve", approved);
    sessions.update("focus-qa", approved, { ...settled, status: "human_review" });
    notify(scene, toasts, "toast-review", approved + 0.1, 3.4);
    scrollBoardTo(scene, track, lane("human_review"), approved + 0.3, 0.9);
    const reviewed = moveCard(scene, card("focus"), body("human_review"), approved + 1.1);

    // 4. The pull request of a reviewed task merges. The task closes by itself, its card keeps no
    // actions, and its session leaves the sidebar.
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
    scene.at(closed - 0.1, () => scene.run(shrinkOut(must(card("typing"), "[data-card-footer]"))));
    notify(scene, toasts, "toast-closed", closed - 0.2, 3);
    sessions.hide("typing-qa", closed - 0.2);

    // 5. A new task arrives in the backlog. Then a Builder asks a question: its session moves to
    // Needs you, and the tile of its workspace shows that a session waits.
    scrollBoardTo(scene, track, lane("open"), closed + 0.6, 1.1);
    addCard(scene, body("open"), scene.template("new-task"), closed + 1.6);
    scrollBoardTo(scene, track, lane("in_progress"), closed + 3, 1);
    const asked = closed + 3.6;
    swapIn(scene, actions("empty"), "builder-waiting", asked);
    scene.at(asked, () => setActivity(card("empty"), "waiting"));
    sessions.update("empty-build", asked, { attention: "Question", running: false });
    notify(scene, toasts, "toast-input", asked + 0.1, 3.6);
    const row = must(root, '[data-nav-entry="empty-build"] [data-nav-row]');
    if (row.getClientRects().length === 0) {
      scene.endAt(asked + 4.5);
      return;
    }

    // 6. The visitor points at the session that waits. Its preview opens next to the sidebar, with
    // the question, and the visitor answers there.
    const preview = scene.template("preview");
    const hovered = cursor.point(() => row, asked + 1.2, 0.9);
    scene.at(hovered + 0.18, () => {
      root.append(preview);
      const space = 12 * designPixel(root);
      const origin = offsetIn(row, root);
      const bottom = root.clientHeight - space - preview.offsetHeight;
      gsap.set(preview, {
        left: origin.x + row.offsetWidth + space,
        top: Math.max(space, Math.min(origin.y, bottom)),
      });
      scene.run(
        gsap.fromTo(
          preview,
          { autoAlpha: 0, scale: 0.97 },
          { autoAlpha: 1, scale: 1, duration: 0.25, ease: EASE.arrive },
        ),
      );
    });
    const noted = answerHere(
      scene,
      must(preview, "[data-reply]"),
      cursor,
      WAITING_QUESTION.answer,
      hovered + 1.3,
    );

    // The answer reaches the Builder: its session goes back to Running, and the preview closes.
    const resumed = noted + 0.9;
    sessions.update("empty-build", resumed, { attention: undefined, running: true });
    swapIn(scene, actions("empty"), "builder-running", resumed);
    scene.at(resumed, () => {
      setActivity(card("empty"), "working");
      scene.run(
        gsap.to(preview, {
          autoAlpha: 0,
          scale: 0.99,
          duration: 0.15,
          ease: EASE.dismiss,
          onComplete: () => preview.remove(),
        }),
      );
    });
    cursor.hide(resumed + 0.3);
    scene.endAt(resumed + 2.6);
  });
}
