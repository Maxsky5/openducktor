import { must } from "../../motion/dom";
import { brandColor, designPixel } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import { mountLoop } from "../../motion/loop";
import { EASE } from "../../motion/tokens";
import {
  boardOf,
  laneCount,
  moveCard,
  setActivity,
  setLaneCount,
  swapIn,
} from "../../replica/board/board";
import { pointer } from "../../replica/shell/pointer";
import { notify } from "../../replica/shell/toast";
import type { LaneId } from "../../replica/vocabulary";
import type { AutopilotRole, AutopilotTemplate } from "./templates";

/** The board collapses empty lanes and scrolls with the task when the lanes do not fit. */
const MOVE = { collapseEmpty: true, follow: true };

/**
 * One task goes from Backlog to Human Review, and nobody clicks. Each time the task enters a
 * status, the matching Autopilot rule starts the next agent from the card. A new session shows
 * the in-app notification of the desktop app, and a resumed session shows none. QA rejects the
 * first build once. The markup holds the last frame: the pull request waits for your approval.
 */
export function mountAutopilot(): void {
  mountLoop<AutopilotTemplate>(must(document, '[data-scene="autopilot"]'), (scene) => {
    const root = must(scene.stage, "[data-root]");
    const toasts = must(scene.stage, "[data-toasts]");
    const { track, lane, body, card, running } = boardOf(scene);
    const task = card("import");
    const other = card("tags");
    const actions = must(task, "[data-card-actions]");
    const badges = must(task, "[data-badges]");
    const cursor = pointer(scene, root);

    // Start: the Spec agent writes the spec of the task in Backlog.
    body("open").prepend(task);
    setLaneCount(lane("open"), laneCount(lane("open")));
    setLaneCount(lane("human_review"), laneCount(lane("human_review")));
    lane("human_review").toggleAttribute("data-collapsed", true);
    actions.replaceChildren(...scene.template("spec-running").childNodes);
    setActivity(task, "working");
    must(badges, "[data-pr-badge]").remove();
    must(other, "[data-card-actions]").replaceChildren(
      ...scene.template("builder-running").childNodes,
    );
    setActivity(other, "working");
    gsap.set(track, { x: 0 });

    /** The session ends. The card shows the button of its next status and moves there. */
    const advance = (status: LaneId, button: AutopilotTemplate, at: number): number => {
      running(task, false, at);
      swapIn(scene, actions, button, at);
      return moveCard(scene, task, body(status), at + 0.3, 0.9, MOVE);
    };

    /**
     * Autopilot starts the agent from the card, and no pointer moves. A new session starts, then
     * runs, and its notification shows. A resumed session runs at once. Returns the time when
     * the agent runs.
     */
    const start = (role: AutopilotRole, at: number, session: "new" | "resumed"): number => {
      scene.at(at, () =>
        scene.run(
          gsap.fromTo(
            task,
            { boxShadow: `0 0 0 0 ${brandColor(task, 0.5)}` },
            {
              boxShadow: `0 0 0 ${10 * designPixel(root)}px ${brandColor(task, 0)}`,
              duration: 0.9,
              ease: EASE.enter,
              clearProps: "boxShadow",
            },
          ),
        ),
      );
      running(task, true, at);
      if (session === "resumed") {
        swapIn(scene, actions, `${role}-running`, at);
        return at;
      }
      swapIn(scene, actions, `${role}-starting`, at);
      notify(scene, toasts, `toast-${role}`, at + 0.3, 3);
      swapIn(scene, actions, `${role}-running`, at + 0.7);
      return at + 0.7;
    };

    const badge = (name: AutopilotTemplate, at: number): void => {
      const next = scene.template(name);
      scene.at(at, () => {
        badges.append(next);
        scene.run(
          gsap.fromTo(
            next,
            { scale: 0.6, autoAlpha: 0 },
            { scale: 1, autoAlpha: 1, duration: 0.4, ease: EASE.snap },
          ),
        );
      });
    };

    // 1. The spec is ready. Autopilot starts the Planner.
    let t = advance("spec_ready", "start-planner", 0.8);
    t = start("planner", t + 0.3, "new");

    // 2. The plan is ready. Autopilot starts the Builder, and the task moves to In Progress.
    t = advance("ready_for_dev", "start-builder", t + 1.3);
    t = start("builder", t + 0.3, "new");
    t = moveCard(scene, task, body("in_progress"), t + 0.3, 0.9, MOVE);

    // 3. The build is done. Autopilot starts QA.
    t = advance("ai_review", "request-qa", t + 1.1);
    t = start("qa", t + 0.3, "new");

    // 4. QA rejects the build. Autopilot resumes the Builder session with the QA report.
    t = advance("in_progress", "address-qa", t + 1.3);
    badge("rejected", t);
    t = start("builder", t + 0.4, "resumed");
    // The other Builder asks a question. Autopilot does not answer for you.
    swapIn(scene, must(other, "[data-card-actions]"), "builder-waiting", t + 0.5);
    scene.at(t + 0.5, () => setActivity(other, "waiting"));
    notify(scene, toasts, "toast-question", t + 0.7, 3.4);

    // 5. The fix is done. Autopilot resumes the QA session.
    scene.at(t + 1.8, () => must(badges, "[data-qa-badge]").remove());
    t = advance("ai_review", "request-qa", t + 1.8);
    t = start("qa", t + 0.3, "resumed");

    // 6. QA approves. Autopilot forks the Builder session to open the pull request.
    t = advance("human_review", "approve", t + 1.3);
    t = start("builder", t + 0.3, "new");
    badge("pr", t + 0.9);
    running(task, false, t + 1.3);
    swapIn(scene, actions, "approve", t + 1.3);

    // 7. Only you can approve the task.
    cursor.point(() => must(actions, "[data-card-action]"), t + 1.7, 1);
    cursor.hide(t + 4.4);
    scene.endAt(t + 4.8);
  });
}
