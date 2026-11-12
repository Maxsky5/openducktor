import { must } from "../../motion/dom";
import { fadeHide, fadeIn } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import type { SceneBuilder } from "../../motion/scene";
import { EASE } from "../../motion/tokens";
import { approvalChoices } from "../../replicas/mobile/approval-choices";
import { finger } from "../../replicas/mobile/finger";
import { menus } from "../../replicas/mobile/menus";
import { screens } from "../../replicas/mobile/screens";
import { stepList } from "../../replicas/mobile/steps";
import { toast } from "../../replicas/mobile/toast";
import { APPROVE_ITEM } from "./sample";

/** Seconds that the host takes to merge locally, and to push and close the task. */
const MERGE = 1.1;
const PUSH = 1.3;

/**
 * The visitor approves the task from its Builder session. Quick Actions opens under the zap
 * button, and Approve Task opens the approval on Pull request. Direct merge shows the merge
 * methods, and Squash adds the suggested commit message. Merge locally applies the merge, and the
 * sheet asks to publish it. Push main and mark done closes the sheet, and the toast says that the
 * task moved to Done. The toast goes, and the rail shows every step done. The markup holds the
 * last frame.
 */
export const build: SceneBuilder = (scene) => {
  const root = must(scene.stage, "[data-root]");
  const steps = stepList(scene, root);
  const phone = screens(scene, root);
  const tap = finger(scene, root).tap;
  const menu = menus(scene, root);
  const approval = approvalChoices(scene, root);
  const session = phone.screen("session");
  const publish = phone.screen("publish");
  const doneToast = toast(scene, root, "done");

  // Start: the Builder session of the task in Human Review.
  phone.only("session");
  approval.show("pull_request", "merge_commit");

  // The zap button opens Quick Actions, and Approve Task opens the approval sheet.
  steps.show(1, 1.0);
  const zap = (): HTMLElement => must(session, "[data-quick-actions]");
  const opened = menu.open("quick", zap, tap(zap, 2.2));
  const item = menu.item("quick", APPROVE_ITEM);
  const chosen = tap(() => item, opened + 1.4);
  scene.at(chosen - 0.2, () => item.toggleAttribute("data-pressed", true));
  const closed = menu.close("quick", chosen);
  scene.at(closed, () => item.removeAttribute("data-pressed"));
  const presented = phone.present("approve", closed);

  // The sheet opens on Pull request. Direct merge shows the merge methods, and Squash adds the
  // suggested message, and the form scrolls until the message shows in full.
  steps.show(2, presented + 0.2);
  const segment = (value: string) => (): HTMLElement =>
    must(approval.sheet, `[data-segment="${value}"]`);
  const direct = tap(segment("direct_merge"), presented + 1.8);
  approval.choose("direct_merge", "merge_commit", direct);
  const squash = tap(() => must(approval.sheet, '[data-option="squash"]'), direct + 1.3);
  approval.choose("direct_merge", "squash", squash);
  const scrolled = approval.reveal(
    () => must(approval.sheet, '[data-for-method="squash"]'),
    squash + 0.4,
  );

  // The visitor reads the message and merges locally. The button shows the progress, then the
  // sheet asks to publish the local merge.
  steps.show(3, scrolled + 0.1);
  const mergeButton = must(approval.sheet, "[data-merge-locally]");
  const merged = tap(() => mergeButton, scrolled + 2.4);
  scene.at(merged, () => mergeButton.toggleAttribute("data-loading", true));
  // The sheet keeps its place. The approval step fades out, then the next step fades in, so the
  // two forms never show together.
  const swapped = merged + MERGE;
  scene.at(swapped, () => {
    scene.run(fadeHide(approval.sheet, 0.15, EASE.dismiss));
  });
  const asked = swapped + 0.15;
  scene.at(asked, () => {
    mergeButton.removeAttribute("data-loading");
    gsap.set(must(approval.sheet, "[data-sheet-body]"), { clearProps: "transform" });
    publish.hidden = false;
    scene.run(fadeIn(publish, 0.2));
  });

  // The visitor reads Local merge ready and the push target. Push main and mark done publishes
  // the merge. The sheet closes, and the toast says that the task moved to Done. When the toast
  // goes, the workflow rail shows every step done.
  steps.show(4, asked + 0.2);
  approval.reveal(() => must(publish, "[data-sheet-body] > :last-child"), asked + 1.6, publish);
  const pushButton = must(publish, "[data-publish]");
  const pushed = tap(() => pushButton, asked + 3.6);
  scene.at(pushed, () => pushButton.toggleAttribute("data-loading", true));
  const done = phone.dismiss("publish", pushed + PUSH);
  scene.at(done, () => pushButton.removeAttribute("data-loading"));
  scene.endAt(doneToast.show(done) + 1.4);
};
