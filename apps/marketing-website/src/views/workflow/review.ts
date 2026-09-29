import { must } from "../../motion/dom";
import { offsetIn } from "../../motion/offset";
import { designPixel, growIn, pop, replaceGrow, shrinkOut } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { typeText } from "../../motion/text";
import { EASE } from "../../motion/tokens";
import { studioWindow } from "../../replica/studio/studio";
import {
  BUILDER_FIX_SESSION,
  BUILDER_PR_SESSION,
  BUILDER_REVIEW_SESSION,
  FIXED_FILES,
  fileOf,
  FRAMES,
  HOOK_PATH,
  REVIEW_COMMENT,
  REVIEWED_FILES,
  TEST_PATH,
} from "../../sample/studio";
import type { RowId } from "../../sample/transcripts";
import { endTurn, showPanel, startSession } from "./session";

/** The templates of ReviewStep.astro. */
export type ReviewTemplate =
  | "old-diff"
  | "comment-form"
  | "comment-card"
  | "pr-dialog"
  | "toast-closed";

/**
 * Review: you comment on a diff line and send the comment to the Builder. The Builder fixes it,
 * publishes the pull request, and waits for the checks. The task closes when it merges.
 */
export function review(scene: Scene<ReviewTemplate>): void {
  const studio = studioWindow(scene);
  const row = (id: RowId<"review">): HTMLElement => studio.row("review", id);
  const prRow = (id: RowId<"pr">): HTMLElement => studio.row("pr", id);
  const git = studio.panels.git();
  const files = must(git, "[data-files]");
  const detect = must(git, "[data-detect]");
  const pr = must(studio.root, "[data-pr]");
  const send = must(studio.root, "[data-send]");
  const badge = must(studio.root, "[data-send-badge]");
  const pill = must(studio.panels.fileItem(HOOK_PATH), "[data-note-pill]");
  const reviewed = must(git, '[data-line="10"]');
  const before = must(scene.template("old-diff"), '[data-line="10"]');

  // Start: QA approved the fix, and the task waits for your review before the pull request.
  studio.hideTurns("review", "pr");
  studio.apply({
    ...FRAMES.review,
    action: "Generate Pull Request",
    actionDisabled: false,
    session: BUILDER_FIX_SESSION,
    panel: "git",
    checksTab: false,
  });
  pr.removeAttribute("data-merged");
  pr.hidden = true;
  studio.panels.setChecks("pending", "10:24:52 AM");
  detect.hidden = false;
  studio.panels.setFile({ ...fileOf(FIXED_FILES, TEST_PATH), del: 0 });
  studio.panels.setTotals(FIXED_FILES);
  studio.panels.setAhead(2);
  reviewed.replaceWith(before);

  // You comment on line 10 of the hook.
  const hovered = studio.cursor.point(() => before, 0.6, 1);
  scene.at(hovered - 0.2, () => before.toggleAttribute("data-hover", true));
  const plus = studio.cursor.click(() => must(before, "[data-comment-add]"), hovered + 0.3, 0.35);
  const form = scene.template("comment-form");
  const text = must(form, "[data-comment-text]");
  const save = must(form, "[data-comment-save]");
  scene.at(plus + 0.15, () => {
    before.removeAttribute("data-hover");
    before.after(form);
    const bottom = offsetIn(form, files).y + form.offsetHeight + 12 * designPixel(studio.root);
    const scroll = bottom - files.clientHeight;
    scene.run(growIn(form, 0.35));
    if (scroll > files.scrollTop)
      scene.run(gsap.to(files, { scrollTop: scroll, duration: 0.5, ease: EASE.move }));
  });
  // The pointer follows the text box after the list scrolls.
  const typing = studio.cursor.point(() => text, plus + 0.65, 0.35) + 0.05;
  scene.at(typing, () => text.toggleAttribute("data-typing", true));
  scene.at(typing + 0.15, () => save.removeAttribute("data-disabled"));
  const typed = typeText(scene, text, REVIEW_COMMENT, typing + 0.1, { charsPerSecond: 40 });
  scene.at(typed + 0.2, () => text.removeAttribute("data-typing"));

  const saved = studio.cursor.click(() => save, typed + 0.3, 0.8);
  const note = scene.template("comment-card");
  scene.at(saved + 0.15, () => {
    scene.run(replaceGrow(form, note));
    must(pill, "[data-note-count]").textContent = "1";
    pill.hidden = false;
    scene.run(pop(pill));
    badge.textContent = "1";
    send.toggleAttribute("data-ready", true);
    scene.run(pop(badge, 1.3));
  });

  // Send builds one message from the pending comment. The Builder fixes line 10.
  studio.patch(saved + 0.9, { focus: "chat" });
  const sent = studio.cursor.click(() => send, saved + 1.1, 1);
  scene.at(sent + 0.1, () => {
    scene.run(shrinkOut(note));
    pill.hidden = true;
    badge.textContent = "";
    send.removeAttribute("data-ready");
  });
  studio.rows.show(row("comment"), sent + 0.2);
  studio.patch(sent + 0.2, { activity: "working", tones: ["done", "done", "in_progress", "done"] });
  studio.cursor.hide(sent + 0.4);

  const fixing = sent + 0.9;
  studio.rows.show(row("hook"), fixing);
  showPanel(studio, fixing + 0.2, 1.7);
  scene.at(fixing + 0.35, () => {
    before.replaceWith(reviewed);
    reviewed.toggleAttribute("data-flash", true);
  });
  studio.rows.show(row("test"), fixing + 0.8);
  studio.panels.fileLines(TEST_PATH, fileOf(REVIEWED_FILES, TEST_PATH).add, fixing + 1);
  studio.panels.totals(REVIEWED_FILES, fixing + 1);
  const ran = studio.rows.tool(row("run"), fixing + 2, 1);
  const committed = studio.rows.tool(row("commit"), ran + 0.3, 0.3);
  studio.panels.ahead(3, committed);
  const fixed = endTurn(
    studio,
    row("final"),
    committed + 0.3,
    { tones: ["done", "done", "done", "done"] },
    { session: BUILDER_REVIEW_SESSION, from: BUILDER_FIX_SESSION.used, since: sent + 0.2 },
  );

  // The same session publishes the pull request and waits for its checks.
  const started = startSession(studio, fixed + 0.6, "pr-dialog", {
    tones: ["done", "done", "in_progress", "done"],
  });
  studio.rows.show(prRow("kickoff"), started + 0.3);
  studio.rows.tool(prRow("fetch"), started + 0.9, 0.4);
  studio.rows.tool(prRow("checks"), started + 1.5, 1.2);
  studio.rows.tool(prRow("push"), started + 2.9, 0.5);
  studio.rows.tool(prRow("create"), started + 3.6, 0.6);
  const linked = studio.rows.workflow(prRow("set"), started + 4.4, 0.4);
  scene.at(linked, () => {
    pr.hidden = false;
    scene.run(pop(pr, 1.12));
    detect.hidden = true;
  });
  studio.patch(linked, { checksTab: true, action: "Request Changes" });

  const watching = linked + 0.4;
  const watched = studio.rows.start(prRow("watch"), watching);
  studio.patch(watching + 0.3, { focus: "panel" });
  const opened = studio.cursor.click(
    () => must(studio.root, '[data-ptab="ci_checks"]'),
    watching + 0.3,
    0.9,
  );
  studio.patch(opened + 0.1, { panel: "ci_checks" });
  studio.cursor.hide(opened + 0.6);
  const passed = opened + 3.4;
  studio.panels.checks("passing", "10:26:35 AM", passed);
  scene.at(passed, () => scene.run(pop(must(studio.root, "[data-checks-badge]"), 1.12)));
  watched(passed + 0.3);
  studio.patch(passed + 1.2, { focus: "chat" });
  const reported = endTurn(
    studio,
    prRow("final"),
    passed + 1.3,
    { tones: FRAMES.review.tones },
    { session: BUILDER_PR_SESSION, from: BUILDER_REVIEW_SESSION.used, since: started },
  );

  // The pull request merges on GitHub, and OpenDucktor closes the task.
  const merged = reported + 1;
  studio.patch(merged - 0.2, { focus: "panel" });
  scene.at(merged, () => {
    pr.toggleAttribute("data-merged", true);
    scene.run(pop(pr, 1.12));
  });
  studio.patch(merged + 0.3, { action: FRAMES.review.action, actionDisabled: true });
  studio.notify("toast-closed", merged + 0.4, 4);
}
