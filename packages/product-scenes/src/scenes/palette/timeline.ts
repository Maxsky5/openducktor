import { must } from "../../motion/dom";
import type { SceneBuilder } from "../../motion/scene";
import { boardOf, setActivity, swapIn } from "../../replicas/board/cards";
import { commandPalette } from "../../replicas/palette/command-palette";
import { pointer } from "../../replicas/shell/cursor";
import { keystrokes } from "../../replicas/shell/keystrokes";
import { sessionList } from "../../replicas/shell/nav-list";
import { startupToast } from "../../replicas/shell/startup-toast";
import { startDialog } from "../../replicas/studio/start-dialog";
import { answerHere } from "../../replicas/transcript/reply";
import { QUERY, SEARCH_TARGET, WAITING_TASK } from "../../sample/palette";
import { WAITING_QUESTION } from "../../sample/question";
import { TASKS } from "../../sample/tasks";
import { PALETTE_NAV, type PaletteTemplate } from "./sample";

/**
 * The palette does the work of two pages from the keyboard. The visitor searches across the
 * workspaces, opens the actions of a task, and starts its Planner in the background. Then the
 * visitor answers the question of a waiting Builder in the palette. The palette opens, changes,
 * and closes at once, as the product does. The markup holds the search results.
 */
export const build: SceneBuilder<PaletteTemplate> = (scene) => {
  const root = must(scene.stage, "[data-root]");
  // The view writes the modifier of its keys, so the key presses match its key caps.
  const { modifier } = root.dataset;
  if (!modifier) throw new Error("The palette view has no modifier key.");
  const palette = commandPalette(scene, root);
  const keys = keystrokes(scene);
  const cursor = pointer(scene, root);
  const sessions = sessionList(scene, root);
  const { card } = boardOf(scene);
  const actions = (name: string): HTMLElement => must(card(name), "[data-card-actions]");

  // Start: the palette is closed.
  palette.reset();
  sessions.place(PALETTE_NAV.entries);

  // 1. Command K opens the palette. The query finds tasks and a chat in three workspaces.
  keys.press([modifier, "K"], 0.6, 1.3);
  palette.open(0.7);
  const typed = palette.type(QUERY, 1.6);
  keys.press(["↓"], typed + 0.9, typed + 1.4);
  palette.down(typed + 0.95);

  // 2. Tab opens the actions of the task. The visitor runs Start Planner.
  const listed = typed + 1.9;
  keys.press(["Tab"], listed, listed + 0.5);
  palette.show("target", listed + 0.05, TASKS.h5w3.title);
  keys.press(["↓"], listed + 0.8, listed + 1.05);
  palette.down(listed + 0.85);
  keys.press(["↓"], listed + 1.15, listed + 1.5);
  palette.down(listed + 1.2);
  const run = listed + 2.1;
  keys.press(["↵"], run, run + 0.6);
  palette.close(run + 0.05);

  // 3. The start dialog opens. Run in background closes it, and the board stays. The startup
  // notification shows the Planner until it is ready.
  const dialog = scene.template("planner-dialog");
  const planning = startDialog(scene, root, cursor, dialog, run + 0.15, "background") - 0.1;
  cursor.hide(planning);
  swapIn(scene, actions(SEARCH_TARGET), "planner-starting", planning);
  scene.at(planning, () => setActivity(card(SEARCH_TARGET), "working"));
  sessions.hide("titles-spec", planning);
  sessions.update("titles-planner", planning);
  const toast = startupToast(scene, must(root, "[data-toasts]"), scene.template("toast-startup"));
  toast.show(planning);
  toast.ready(planning + 0.9);
  swapIn(scene, actions(SEARCH_TARGET), "planner-running", planning + 0.9);

  // 4. Command K again. The Builder that waits comes first, and Tab opens its reply.
  const again = planning + 2.2;
  keys.press([modifier, "K"], again, again + 0.7);
  palette.open(again + 0.1);
  keys.press(["Tab"], again + 1.2, again + 1.7);
  palette.show("waiting", again + 1.25, WAITING_TASK.title);
  keys.press(["↵"], again + 2.1, again + 2.6);
  palette.show("reply", again + 2.15);

  // 5. The visitor answers in the palette. The palette closes after the last reply.
  const noted = answerHere(
    scene,
    must(root, "[data-reply]"),
    cursor,
    WAITING_QUESTION.answer,
    again + 2.8,
  );
  cursor.hide(noted - 0.1);
  const replied = noted + 0.8;
  palette.close(replied);
  swapIn(scene, actions(WAITING_TASK.id), "builder-running", replied + 0.1);
  scene.at(replied + 0.1, () => setActivity(card(WAITING_TASK.id), "working"));
  sessions.update("empty-build", replied + 0.1, { attention: undefined, running: true });
  scene.endAt(replied + 3.4);
};
