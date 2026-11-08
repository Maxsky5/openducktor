import { must } from "../../motion/dom";
import { fadeIn } from "../../motion/effects";
import type { SceneBuilder } from "../../motion/scene";
import { composerActivity, composerDraft } from "../../replicas/shell/composer";
import { createMenu } from "../../replicas/shell/create-menu";
import { pointer } from "../../replicas/shell/cursor";
import { sessionList } from "../../replicas/shell/nav-list";
import { importSessionDialog } from "../../replicas/studio/import-session-dialog";
import { follow, transcript } from "../../replicas/transcript/rows";
import {
  ENTRY,
  FOLLOW_UP,
  IMPORTED,
  type ImportSessionTemplate,
  MATCHES,
  NAV,
  RUNTIME,
  RUNTIMES,
  SEARCH,
  SESSIONS,
} from "./sample";

/**
 * A Claude Code conversation continues in OpenDucktor. The visitor opens the menu of the arrow
 * beside New task and selects Import session from an external runtime. In the dialog, the visitor
 * chooses Claude, the list loads, and a search filters it. Import opens the session page with the
 * history of the conversation. The visitor sends a follow-up, and the agent starts to work. The
 * markup holds the dialog with the full list.
 */
export const build: SceneBuilder<ImportSessionTemplate> = (scene) => {
  const root = must(scene.stage, "[data-root]");
  const board = must(root, '[data-page="board"]');
  const page = must(root, '[data-page="session"]');
  const kanban = must(root, "[data-kanban]");
  const trigger = must(root, "[data-create-trigger]");
  const followUp = must(page, '[data-row="follow-up"]');
  const dialog = importSessionDialog(scene, root);
  const sessions = sessionList(scene, root);
  const setActivity = composerActivity(page);
  const composer = composerDraft(scene, page);
  const rows = transcript(scene, root);
  const cursor = pointer(scene, root);
  follow(scene, must(page, "[data-track]"));

  // Start: the board. The dialog is closed, and the imported session is not in the sidebar yet.
  sessions.place(NAV.entries);
  dialog.reset();
  page.hidden = true;
  followUp.hidden = true;
  must(page, "[data-meter]").hidden = true;
  setActivity("idle");

  // The arrow beside New task opens the menu under it, aligned to its end.
  const menu = createMenu(scene, root, cursor, trigger, scene.template("menu"));
  const opened = menu.open(0.3);

  // Import session from an external runtime closes the menu, as popover.css does. The dialog
  // opens when the menu is gone.
  const picked = menu.pick("import-session", opened + 0.6, 0.7);
  dialog.open(picked + 0.2);

  // The visitor opens the runtime list and chooses Claude. The highlight follows the pointer down
  // the list. The dialog grows, and the list loads.
  const [first, second] = RUNTIMES;
  if (!first || !second) throw new Error("The scene needs two runtimes before Claude.");
  const listed = cursor.click(dialog.trigger, picked + 0.8, 0.7);
  dialog.openOptions(listed + 0.05, first.kind);
  const chosen = cursor.click(dialog.option(RUNTIME.kind), listed + 0.55, 0.5);
  scene.at(chosen - 0.24, () => dialog.highlight(second.kind));
  scene.at(chosen - 0.15, () => dialog.highlight(RUNTIME.kind));
  dialog.choose(RUNTIME.kind, chosen);
  const loaded = chosen + 1.2;
  dialog.showRows(
    SESSIONS.map((session) => session.id),
    loaded,
  );
  cursor.hide(chosen + 0.3);

  // The visitor searches. The rows that match in the title, the ID, or the directory stay.
  const searched = cursor.click(dialog.search, loaded + 1.3, 0.8);
  const typed = dialog.typeSearch(SEARCH, searched + 0.2);
  const filtered = typed + 0.6;
  dialog.showRows(MATCHES, filtered);

  // Import shows its spinner. Then the dialog closes, and the session page opens with the history.
  const imported = cursor.click(dialog.importButton(IMPORTED.id), filtered + 0.6, 0.8);
  dialog.startImport(IMPORTED.id, imported);
  cursor.hide(imported + 0.4);
  const ready = imported + 1.1;
  dialog.close(ready);
  scene.at(ready, () => {
    board.hidden = true;
    page.hidden = false;
    root.dataset.pane = "main";
    kanban.removeAttribute("aria-current");
    scene.run(fadeIn(page, 0.3));
  });
  sessions.update(ENTRY.id, ready, { selected: true, time: "now" });

  // The visitor sends a follow-up. The agent starts, and the session runs.
  const clicked = cursor.click(() => composer.editor, ready + 1.2, 0.8);
  composer.focus(clicked);
  const written = composer.type(FOLLOW_UP, clicked + 0.3, 26);
  const sent = cursor.click(() => composer.button, written + 0.25, 0.7);
  composer.send(sent);
  scene.at(sent, () => setActivity("working"));
  rows.show(followUp, sent + 0.1);
  sessions.update(ENTRY.id, sent + 0.1, { running: true });
  cursor.hide(sent + 0.35);
  scene.endAt(sent + 3);
};
