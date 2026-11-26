import { must } from "../../motion/dom";
import { fadeIn } from "../../motion/effects";
import type { SceneBuilder } from "../../motion/scene";
import { processSummary } from "../../replicas/processes/model";
import { processesView } from "../../replicas/processes/processes";
import { pointer } from "../../replicas/shell/cursor";
import { sessionList } from "../../replicas/shell/nav-list";
import { follow, transcript } from "../../replicas/transcript/rows";
import {
  AFTER_STOP,
  BEFORE_STOP,
  BUILDER_ENTRY,
  REPOSITORY_CHECKOUT,
  START_NAV,
  WATCHER,
} from "./sample";

/** Seconds from the start of the dev server to the read that finds it. */
const READ_AFTER = 0.6;

/** Seconds that the visitor reads the open list before the pointer goes to Stop. */
const READ_LIST = 1.4;

/** Seconds that the visitor reads the confirmation before the pointer goes to its Stop. */
const READ_CONFIRM = 1;

/** Seconds from the confirmation to the read without the watcher: the stop and its check. */
const STOPPING = 0.6;

/** Seconds that the visitor reads the shorter list before Detach. */
const READ_STOPPED = 0.9;

/** Seconds that the pointer rests on a part of the window before it drags the part. */
const GRAB = 0.19;

/** Seconds from the release of a drag to the next step. */
const LET_GO = 0.09;

/** Seconds that the last frame holds before the loop ends. */
const HOLD = 2;

/**
 * The Processes view. The Builder of the task starts the dev server, and the next read finds it
 * with the test watcher of the repository checkout: the Processes button shows 2, and the top bar
 * of the session shows its port. You open the list beside the rail, stop the watcher, and its
 * checkout leaves the list. Then you detach the list into a floating window and make it smaller.
 * You open the Kanban board, the window stays on top, and you move it to the empty lower right of
 * the board. The markup holds the last frame.
 */
export const build: SceneBuilder = (scene) => {
  const root = must(scene.stage, "[data-root]");
  const page = must(root, '[data-page="session"]');
  const board = must(root, '[data-page="board"]');
  const kanban = must(root, "[data-kanban]");
  const row = (name: string): HTMLElement => must(page, `[data-row="${name}"]`);
  const sessions = sessionList(scene, root);
  const rows = transcript(scene, root);
  const cursor = pointer(scene, root);
  const view = processesView(scene, root, cursor);
  const ports = must(page, "[data-task-ports]");
  /** The pane that a phone stage shows. */
  const setPane = (pane: "sidebar" | "main"): void => {
    root.dataset.pane = pane;
  };

  // Start: the session page of the task, whose Builder works. No command runs, and the view is
  // closed.
  sessions.place(START_NAV);
  kanban.removeAttribute("aria-current");
  board.hidden = true;
  page.hidden = false;
  setPane("main");
  follow(scene, must(page, "[data-track]"));
  view.reset();
  view.setFocused(true);
  ports.hidden = true;

  // 1. The Builder starts the dev server in the background, so its call ends at once. The next
  //    read finds it and the watcher: the badge shows 2, and the top bar shows the port of the
  //    task. The Builder says where the app runs.
  const served = rows.tool(row("serve"), 0.5, 0.3);
  const found = served + READ_AFTER;
  view.count(
    BEFORE_STOP.reduce((total, group) => total + group.commands.length, 0),
    found,
  );
  scene.at(found, () => {
    ports.hidden = false;
    scene.run(fadeIn(ports, 0.2));
  });
  scene.mark("found", found);
  rows.say(row("after"), found + 0.3);

  // 2. You open Processes. The list opens beside the rail with the worktree of the task first.
  const opened = cursor.click(() => view.button, found + 1, 0.9);
  view.open(opened + 0.05);
  scene.mark("open", opened);

  // 3. You stop the watcher. Stop asks beside its button, and the second Stop sends the quit
  //    signal. The pointer leaves for Detach, so the line shows Stopping… in full. Then the next
  //    read has no command in the checkout, and the checkout folds away.
  const asked = cursor.click(() => view.stopOf(WATCHER.id), opened + READ_LIST, 0.8);
  view.ask(WATCHER.id, asked + 0.05);
  const confirmed = cursor.click(view.confirmButton, asked + READ_CONFIRM, 0.5);
  view.stop(WATCHER.id, confirmed + 0.05);
  scene.mark("stop", confirmed);
  cursor.point(view.detachButton, confirmed + 0.15, 0.6);
  const stopped = confirmed + STOPPING;
  view.fold(REPOSITORY_CHECKOUT.id, processSummary(AFTER_STOP), stopped);

  // 4. You detach the list. The floating window opens where the flyout was, and you drag its
  //    corner to its minimum size.
  const detached = cursor.click(view.detachButton, stopped + READ_STOPPED, 0.15);
  view.detach(detached + 0.05);
  scene.mark("detach", detached);
  const gripped = cursor.point(view.grip, detached + 0.45, 0.5);
  const resized = view.resize(gripped + GRAB, 0.6) + LET_GO;

  // 5. You open the Kanban board. The board takes the place of the session page at once, and the
  //    floating window stays on top. The board shows no task, so the checkout loses its badge. A
  //    phone stage shows the sidebar for the click, then the board.
  scene.at(resized + 0.05, () => setPane("sidebar"));
  const navigated = cursor.click(() => kanban, resized + 0.12, 0.75);
  scene.at(navigated + 0.05, () => {
    page.hidden = true;
    board.hidden = false;
    kanban.setAttribute("aria-current", "true");
    setPane("main");
    view.setFocused(false);
  });
  sessions.update(BUILDER_ENTRY.id, navigated + 0.05, { selected: false });
  scene.mark("kanban", navigated);

  // 6. You move the window by its title bar to the empty lower right of the board.
  const held = cursor.point(view.titleBar, navigated + 0.5, 0.45);
  const moved = view.drag(held + GRAB, 0.9) + LET_GO;
  scene.mark("floating", moved);
  cursor.hide(moved + 0.4);
  scene.endAt(moved + HOLD);
};
