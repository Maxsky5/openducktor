import { must } from "../../motion/dom";
import { fadeIn } from "../../motion/effects";
import type { SceneBuilder } from "../../motion/scene";
import { composerActivity, composerDraft } from "../../replicas/shell/composer";
import { createMenu } from "../../replicas/shell/create-menu";
import { pointer } from "../../replicas/shell/cursor";
import { sessionList } from "../../replicas/shell/nav-list";
import { sessionCreateDialog } from "../../replicas/studio/session-create";
import { transcript } from "../../replicas/transcript/rows";
import {
  BRANCH_PREFIX,
  ENTRY,
  MESSAGE,
  NAME,
  NAV,
  type NewSessionTemplate,
  WORKTREE,
} from "./sample";

/**
 * A workspace session starts in a new worktree. The visitor opens the menu of the arrow beside New
 * task and selects New session. In the dialog, the visitor names the session, keeps the model,
 * selects New worktree, checks the target branch, names the worktree, and selects Create session.
 * The dialog shows each startup step, then the session page opens. The visitor sends the first
 * message, and the agent starts to work. The markup holds the filled dialog.
 */
export const build: SceneBuilder<NewSessionTemplate> = (scene) => {
  const root = must(scene.stage, "[data-root]");
  const board = must(root, '[data-page="board"]');
  const page = must(root, '[data-page="session"]');
  const kanban = must(root, "[data-kanban]");
  const trigger = must(root, "[data-create-trigger]");
  const message = must(page, '[data-row="message"]');
  const dialog = sessionCreateDialog(scene, root);
  const sessions = sessionList(scene, root);
  const setActivity = composerActivity(page);
  const composer = composerDraft(scene, page);
  const rows = transcript(scene, root);
  const cursor = pointer(scene, root);

  // Start: the board. The dialog is closed, and the new session is not in the sidebar yet.
  sessions.place(NAV.entries);
  dialog.reset();
  page.hidden = true;
  message.hidden = true;
  must(page, "[data-meter]").hidden = true;
  setActivity("idle");

  // The arrow beside New task opens the menu under it, aligned to its end.
  const menu = createMenu(scene, root, cursor, trigger, scene.template("menu"));
  const opened = menu.open(0.3);

  // New session closes the menu and opens the dialog.
  const picked = menu.pick("session", opened + 0.6, 0.6);
  dialog.open(picked + 0.15);

  // The visitor names the session. The runtime, the model, and the effort keep the defaults.
  const named = cursor.click(() => dialog.field("name"), picked + 0.7, 0.7);
  const typed = dialog.type("name", NAME, named + 0.2);
  dialog.focus("name", named, typed + 0.3);

  // New worktree shows its fields under Target branch, and the body scrolls to them.
  const worktree = cursor.click(() => dialog.location("local_worktree"), typed + 0.3, 0.8);
  dialog.select("local_worktree", worktree);
  const scrolled = dialog.scrollToEnd(worktree + 0.3);

  // The visitor checks the target branch, then names the worktree. Its directory and its branch
  // show under the name.
  const checked = cursor.point(dialog.target, scrolled + 0.1, 0.7);
  const focused = cursor.click(() => dialog.field("worktree"), checked + 0.6, 0.6);
  const worktreeTyped = dialog.typeWorktree(WORKTREE, BRANCH_PREFIX, focused + 0.2);
  dialog.focus("worktree", focused, worktreeTyped + 0.3);
  const revealed = dialog.scrollToEnd(worktreeTyped + 0.1, 0.3);

  // Create session starts the worktree and the session. The dialog shows each step.
  const created = cursor.click(dialog.create, revealed + 0.2, 0.8);
  const progress = created + 0.35;
  dialog.start(created, progress);
  const started = dialog.runSteps(progress, 1);
  cursor.hide(progress + 0.3);

  // The ready session opens. The board leaves, and the session joins the sidebar.
  const ready = started + 0.3;
  dialog.close(ready);
  scene.at(ready + 0.1, () => {
    board.hidden = true;
    page.hidden = false;
    root.dataset.pane = "main";
    kanban.removeAttribute("aria-current");
    scene.run(fadeIn(page, 0.3));
  });
  sessions.update(ENTRY.id, ready + 0.1, { selected: true, time: "now" });

  // The visitor types the first message and sends it. The agent starts, and the session runs.
  const clicked = cursor.click(() => composer.editor, ready + 0.8, 0.8);
  composer.focus(clicked);
  const written = composer.type(MESSAGE, clicked + 0.3, 26);
  const sent = cursor.click(() => composer.button, written + 0.25, 0.7);
  composer.send(sent);
  scene.at(sent, () => setActivity("working"));
  rows.show(message, sent + 0.1);
  sessions.update(ENTRY.id, sent + 0.1, { running: true });
  cursor.hide(sent + 0.35);
  scene.endAt(sent + 3.4);
};
