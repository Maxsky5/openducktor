import { must } from "../../motion/dom";
import { mountLoop } from "../../motion/loop";
import { boardOf, setActivity, swapIn } from "../../replica/board/board";
import { commandPalette } from "../../replica/palette/palette";
import { pointer } from "../../replica/shell/pointer";
import { sessionList } from "../../replica/shell/sidebar";
import { notify } from "../../replica/shell/toast";
import { startDialog } from "../../replica/studio/start-dialog";
import { answerHere } from "../../replica/transcript/reply";
import { QUERY, SEARCH_TARGET, WAITING_TASK } from "../../sample/palette";
import { WAITING_QUESTION } from "../../sample/question";
import { TASKS } from "../../sample/tasks";
import { keystrokes } from "./keys";
import { PALETTE_NAV, type PaletteTemplate } from "./templates";

/**
 * The palette does the work of two pages from the keyboard. The visitor searches across the
 * workspaces, opens the actions of a task, and starts its Planner in the background. Then the
 * visitor answers the question of a waiting Builder in the palette. The palette opens, changes,
 * and closes at once, as the product does. The markup holds the search results.
 */
export function mountPalette(): void {
  mountLoop<PaletteTemplate>(must(document, '[data-scene="palette"]'), (scene) => {
    const root = must(scene.stage, "[data-root]");
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
    keys.press(["⌘", "K"], 0.6, 1.3);
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

    // 3. The start dialog opens. The Planner runs in the background, and the board stays.
    const dialog = scene.template("planner-dialog");
    const planning = startDialog(scene, root, cursor, dialog, run + 0.15, "background") - 0.1;
    cursor.hide(planning);
    swapIn(scene, actions(SEARCH_TARGET), "planner-starting", planning);
    scene.at(planning, () => setActivity(card(SEARCH_TARGET), "working"));
    sessions.hide("titles-spec", planning);
    sessions.update("titles-planner", planning);
    notify(scene, must(root, "[data-toasts]"), "toast-started", planning + 0.2, 3);
    swapIn(scene, actions(SEARCH_TARGET), "planner-running", planning + 0.9);

    // 4. Command K again. The Builder that waits comes first, and Tab opens its reply.
    const again = planning + 2.2;
    keys.press(["⌘", "K"], again, again + 0.7);
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
  });
}
