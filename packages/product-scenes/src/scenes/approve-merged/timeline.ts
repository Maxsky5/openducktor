import { must } from "../../motion/dom";
import type { SceneBuilder } from "../../motion/scene";
import { showOnBoard } from "../../replicas/board/board-scroll";
import { boardOf, laneCount, setLaneCount } from "../../replicas/board/cards";
import { pointer } from "../../replicas/shell/cursor";
import { notify } from "../../replicas/shell/notify";
import { closeTaskDialog } from "../../replicas/tasks/close-task-dialog";
import { tooltip } from "../../replicas/ui/tip";
import { type ApproveMergedTemplate, MERGED_TIP } from "./sample";

/**
 * Seconds before a tooltip of the board shows while the pointer rests on its trigger: the
 * delayDuration of the TooltipProvider of kanban-page-content.tsx.
 */
const TIP_DELAY = 0.12;

/** Seconds that the visitor reads the tooltip of the Merged badge. */
const TIP_READ = 1.1;

/**
 * Seconds of the loader of the dialog. The reads of the close end sooner, and useMinimumLoader
 * keeps the loader 500 ms.
 */
const LOAD = 0.5;

/** Seconds that the visitor reads the dialog before the pointer goes to Close task. */
const REVIEW = 1.9;

/** Seconds that the close runs. */
const CLOSE = 0.8;

/**
 * Seconds from the board update to the success toast. closeTask of use-task-mutation-commands.ts
 * reads the stop impact and the worktree again after the host closes the task, and the board
 * takes the closed task from the task events of the host in that time.
 */
const SETTLE = 0.1;

/** Seconds that each toast stays. */
const HOLD = 3;

/**
 * A merge detection pass of the host found that the branch of a task in Human Review is merged:
 * the card shows Merged and leads with Close Task. The pointer rests on the badge, and its tooltip
 * shows the target branch. The visitor selects Close Task, and the Close task dialog reads the
 * task, then shows the merge status and the cleanup choice. The visitor closes the task: the card
 * shows in Done at once, as the app moves a card with no motion, the toast says that the task is
 * closed, and the dialog closes. The notification of the Done state follows. The markup holds the
 * first frame.
 */
export const build: SceneBuilder<ApproveMergedTemplate> = (scene) => {
  const root = must(scene.stage, "[data-root]");
  const toasts = must(root, "[data-toasts]");
  const { track, lane, body, card: cardOf } = boardOf(scene);
  const dialog = closeTaskDialog(scene, root);
  const cursor = pointer(scene, root);
  const tip = tooltip(scene, root);
  const card = cardOf("import");
  const badge = must(card, "[data-merged-badge]");
  const done = scene.template("done-card");

  // Start: the card shows Merged and Close Task. A phone stage shows one lane: Human Review first,
  // and Done when the card moves there.
  dialog.reset();
  showOnBoard(track, lane("human_review"));
  scene.mark("merged", 0.3);

  // The pointer comes onto the card, whose border takes the hover color, and rests on the Merged
  // badge. After the delay of the tooltip, the tooltip shows the target branch on the top side.
  scene.at(0.5, () => card.toggleAttribute("data-hover", true));
  const pointed = cursor.point(() => badge, 0.5, 0.8);
  scene.at(pointed + TIP_DELAY, () => tip.show(badge, MERGED_TIP, "top"));

  // The visitor selects Close Task. The tooltip closes when the pointer leaves the badge, and the
  // Close task dialog opens over the card, so the card loses the hover. The dialog shows its
  // loader, then the merge status and the cleanup choice.
  const left = pointed + TIP_DELAY + TIP_READ;
  scene.at(left + 0.05, () => tip.hide());
  const clicked = cursor.click(() => must(card, "[data-card-action]"), left, 0.55);
  scene.mark("close", clicked);
  const opened = clicked + 0.1;
  scene.at(opened, () => card.removeAttribute("data-hover"));
  const read = dialog.open(opened, LOAD);

  // The visitor closes the task, in the order of the close confirmation of the app. The host
  // closes the task, and the board shows the card in Done at once, without its badge and its
  // actions. On a phone stage, the board shows Done behind the dialog. Then closeTask shows the
  // success toast, and the dialog closes. The notification of the Done state follows.
  const confirmed = cursor.click(dialog.confirm, read + REVIEW, 0.9);
  dialog.submit(confirmed);
  scene.mark("confirm", confirmed);
  const closed = confirmed + CLOSE;
  scene.at(closed - SETTLE, () => {
    card.remove();
    body("closed").append(done);
    for (const status of ["human_review", "closed"] as const)
      setLaneCount(lane(status), laneCount(lane(status)));
    showOnBoard(track, done);
  });
  notify(scene, toasts, "toast-feedback", closed, HOLD);
  dialog.close(closed);
  cursor.hide(closed);
  notify(scene, toasts, "toast-closed", closed + 0.4, HOLD);
  scene.mark("closed", closed);
  scene.endAt(closed + 0.4 + HOLD + 1);
};
