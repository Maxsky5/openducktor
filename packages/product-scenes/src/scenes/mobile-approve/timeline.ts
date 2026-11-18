import { must } from "../../motion/dom";
import { gsap } from "../../motion/gsap";
import type { SceneBuilder } from "../../motion/scene";
import { approvalChoices } from "../../replicas/mobile/approval-choices";
import { finger } from "../../replicas/mobile/finger";
import { menus } from "../../replicas/mobile/menus";
import { APPROVE_ACTION } from "../../replicas/mobile/review-actions";
import { screens } from "../../replicas/mobile/screens";
import { stepList } from "../../replicas/mobile/steps";
import { toast } from "../../replicas/mobile/toast";
import { topButton } from "../../replicas/mobile/top-button";

/** Seconds that the host takes to merge locally, and to push and close the task. */
const MERGE = 1.25;
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
  topButton(scene, session);
  const publish = phone.screen("publish");
  const doneToast = toast(scene, root, "done");

  // Start: the Builder session of the task in Human Review.
  phone.only("session");
  approval.show("pull_request", "merge_commit");

  // The zap button opens Quick Actions, and Approve Task opens the approval sheet. On Android, the
  // chosen action opens its sheet at once, while the menu fades over it.
  steps.show(1, 1.0);
  const zap = (): HTMLElement => must(session, "[data-quick-actions]");
  const opened = menu.open("quick", zap, tap(zap, 2.2));
  const item = menu.item("quick", APPROVE_ACTION);
  const chosen = tap(() => item, opened + 1.4);
  menu.close("quick", chosen);
  const presented = phone.present("approve", chosen);
  scene.mark("approve", presented);

  // The sheet opens on Pull request. Direct merge shows the merge methods, and Squash adds the
  // suggested message, and the form scrolls until the message shows in full.
  steps.show(2, presented + 0.2);
  const segment = (value: string) => (): HTMLElement =>
    must(approval.sheet, `[data-segment="${value}"]`);
  const direct = tap(segment("direct_merge"), presented + 1.8);
  approval.choose("direct_merge", "merge_commit", direct);
  const squash = tap(() => must(approval.sheet, '[data-option="squash"]'), direct + 1.3);
  approval.choose("direct_merge", "squash", squash);
  scene.mark("squash", squash);
  const scrolled = approval.reveal(
    () => must(approval.sheet, '[data-for-method="squash"]'),
    squash + 0.4,
  );

  // The visitor reads the message and merges locally. The button shows the progress, and the
  // merge disables the other controls. Then the sheet asks to publish the local merge.
  steps.show(3, scrolled + 0.1);
  const mergeButton = must(approval.sheet, "[data-merge-locally]");
  const merged = tap(() => mergeButton, scrolled + 2.4);
  phone.busy("approve", mergeButton, merged);
  scene.mark("merge", merged);
  // The sheet keeps its place, and the next step of the approval takes the place of the first
  // at once: the title, the lead, and the form change in one frame, as in the app.
  const asked = merged + MERGE;
  scene.at(asked, () => {
    gsap.set(must(approval.sheet, "[data-sheet-body]"), { clearProps: "transform" });
    approval.sheet.hidden = true;
    publish.hidden = false;
  });
  scene.mark("publish", asked);

  // The visitor reads Local merge ready and the push target. Push main and mark done publishes
  // the merge: the button reads Pushing main, and the push disables the other controls. The
  // sheet closes, and the toast says that the task moved to Done. When the toast goes, the
  // workflow rail shows every step done.
  steps.show(4, asked + 0.2);
  approval.reveal(() => must(publish, "[data-sheet-body] > :last-child"), asked + 1.6, publish);
  const pushButton = must(publish, "[data-publish]");
  const pushed = tap(() => pushButton, asked + 3.6);
  phone.busy("publish", pushButton, pushed);
  scene.mark("push", pushed);
  const done = phone.dismiss("publish", pushed + PUSH);
  scene.mark("done", done);
  scene.endAt(doneToast.show(done) + 1.4);
};
