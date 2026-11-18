import { must } from "../../motion/dom";
import type { SceneBuilder } from "../../motion/scene";
import { composerActivity, composerDraft } from "../../replicas/shell/composer";
import { pointer } from "../../replicas/shell/cursor";
import { sessionList } from "../../replicas/shell/nav-list";
import { forkDialog } from "../../replicas/studio/fork-dialog";
import { follow, transcript } from "../../replicas/transcript/rows";
import { tooltip } from "../../replicas/ui/tip";
import { FOLLOW_UP, FORK_ENTRY, FORK_TIP, NAV, SOURCE_ENTRY } from "./sample";

/**
 * Seconds before a tooltip shows while the pointer rests on its trigger: the delayDuration of
 * TooltipProvider in components/ui/tooltip.tsx.
 */
const TIP_DELAY = 0.08;

/**
 * A workspace session forks from an earlier reply. The pointer rests on the fork button of the
 * first reply, and its tooltip shows Fork from this reply. The visitor selects the button, and the
 * Fork session dialog opens. The visitor selects New worktree, checks the worktree name that the
 * form suggests, and selects Fork session. The dialog shows each startup step, then the fork opens
 * under the dialog with the first turn and the separator Session forked here, and shows in the
 * sidebar. The visitor sends another follow-up, and the agent starts to work. The markup holds the
 * dialog with New worktree selected.
 */
export const build: SceneBuilder = (scene) => {
  const root = must(scene.stage, "[data-root]");
  const source = must(root, '[data-page="source"]');
  const page = must(root, '[data-page="fork"]');
  const fork = must(source, '[data-row="first-reply"] [data-fork]');
  const followUp = must(page, '[data-row="follow-up"]');
  const dialog = forkDialog(scene, root);
  const sessions = sessionList(scene, root);
  const setActivity = composerActivity(page);
  const composer = composerDraft(scene, page);
  const rows = transcript(scene, root);
  const cursor = pointer(scene, root);
  const tip = tooltip(scene, root);
  follow(scene, must(page, "[data-track]"));

  // Start: the source session after two turns. The dialog is closed, and the fork is not in the
  // sidebar yet.
  sessions.place(NAV.entries);
  dialog.reset();
  page.hidden = true;
  followUp.hidden = true;
  must(page, "[data-meter]").hidden = true;
  setActivity("idle");

  // The pointer rests on the fork button of the first reply. After the delay of the tooltip, the
  // tooltip shows on the top side of the button. The visitor selects the button: the press closes
  // the tooltip, and the Fork session dialog opens.
  const pointed = cursor.point(() => fork, 0.4, 1);
  scene.at(pointed, () => fork.toggleAttribute("data-hover", true));
  scene.at(pointed + TIP_DELAY, () => tip.show(fork, FORK_TIP, "top"));
  scene.mark("point", pointed);
  const forked = cursor.click(() => fork, pointed + 0.75, 0.1);
  scene.at(forked, () => tip.hide());
  scene.at(forked + 0.2, () => fork.removeAttribute("data-hover"));
  dialog.open(forked + 0.15);
  scene.mark("dialog", forked + 0.15);

  // New worktree shows its fields with the suggested name. The window shows the whole dialog, and
  // on a phone stage the body scrolls to the fields.
  const selected = cursor.click(() => dialog.location("new_worktree"), forked + 0.8, 0.8);
  dialog.select("new_worktree", selected);
  scene.mark("worktree", selected);
  const scrolled = dialog.scrollToEnd(selected + 0.2, 0.3);

  // The visitor checks the worktree name, then selects Fork session. The button shows that the
  // fork starts, then the dialog shows each step.
  const checked = cursor.point(dialog.worktree, scrolled, 0.6);
  const confirmed = cursor.click(dialog.confirm, checked + 0.6, 0.7);
  const progress = confirmed + 0.6;
  dialog.start(confirmed, progress);
  scene.mark("confirm", confirmed);
  const started = dialog.runSteps(progress, 0.8);
  cursor.hide(progress + 0.3);

  // The fork opens before the handoff closes the dialog, as use-workspace-fork-handoff.ts does:
  // its page takes the place of the source page at once under the dialog, with the first turn and
  // the separator of the fork. The fork shows in the sidebar next to the source, and then the
  // dialog closes over the page.
  const ready = started + 0.3;
  scene.at(ready, () => {
    page.hidden = false;
    source.hidden = true;
  });
  sessions.update(SOURCE_ENTRY.id, ready, { selected: false });
  sessions.update(FORK_ENTRY.id, ready, { selected: true, time: "now" });
  dialog.close(ready);
  scene.mark("forked", ready);

  // The visitor sends another follow-up. The agent starts, and the fork runs.
  const clicked = cursor.click(() => composer.editor, ready + 0.7, 0.8);
  composer.focus(clicked);
  const written = composer.type(FOLLOW_UP, clicked + 0.3, 28);
  const sent = cursor.click(() => composer.button, written + 0.25, 0.7);
  composer.send(sent);
  scene.mark("sent", sent);
  scene.at(sent, () => setActivity("working"));
  rows.show(followUp, sent + 0.1);
  sessions.update(FORK_ENTRY.id, sent + 0.1, { running: true });
  cursor.hide(sent + 0.35);
  scene.endAt(sent + 2.8);
};
