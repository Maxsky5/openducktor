import { must } from "../../motion/dom";
import type { SceneBuilder } from "../../motion/scene";
import { artifactTab } from "../../replicas/studio/artifact-tab";
import { modal } from "../../replicas/studio/modal";
import { studioWindow } from "../../replicas/studio/studio";
import { tooltip } from "../../replicas/ui/tip";
import { STORY_SESSIONS } from "../../sample/studio-nav";
import { type ArtifactsTemplate, MOCKUP, WORKING } from "./sample";

/** The tooltip of the Expand button: ToolButton of artifact-controls.tsx. */
const EXPAND = "Expand";

/**
 * Task artifacts: the visitor asked the Builder for an HTML wireframe of the search dialog. The
 * Builder says what it will draw, then saves the page on the task with odt_set_task_artifact. The
 * card of the call runs, then shows the saved file with Open, and the Artifacts tab adds the file
 * under the workflow documents. The Builder ends its turn. The visitor opens the file from its row,
 * and the tab shows the rendered page. Expand opens the page in a large dialog. The visitor reads
 * it and closes the dialog. The marks name the card, the new row, and the full preview. The markup
 * holds the last frame.
 */
export const build: SceneBuilder<ArtifactsTemplate> = (scene) => {
  const studio = studioWindow(scene);
  const { root, rows, cursor } = studio;
  const row = (id: string): HTMLElement => must(root, `[data-row="${id}"]`);
  const tab = artifactTab(scene, root);
  const tip = tooltip(scene, root);
  const preview = modal(scene, root, scene.template("preview-dialog"), { attach: true });
  const close = must(preview.box, "[data-dialog-close]");
  const file = tab.row(MOCKUP.id);

  // Start: the visitor sent the message, and the Builder works on its turn. The Artifacts tab lists
  // the documents of the Spec and the Planner.
  studio.apply(WORKING, "working");
  tab.showCollection();

  // The Builder says what it will draw, then saves the page on the task. The card runs, then
  // shows the saved file and its Open button. A narrow stage then shows the Artifacts tab.
  const said = rows.say(row("intro"), 0.4);
  const card = said + 0.3;
  scene.mark("saved", card);
  const saved = rows.workflow(row("save"), card, 0.7);
  studio.patch(saved, { focus: "panel" });

  // The tab reads the collection again and adds the file under the workflow documents.
  const listed = saved + 0.5;
  tab.addFiles(listed);
  scene.mark("listed", listed);

  // The Builder ends its turn. Its step on the rail stops the spinner.
  const ended = rows.say(row("saved"), saved + 0.5);
  scene.mark("said", ended);
  // The marks of each wait keep a short margin to the changes of the screen, so a film can play the
  // wait faster: the rests and the travel of the pointer to the file.
  scene.mark("said-rest", ended + 0.05);
  scene.mark("to-file", ended + 0.4);
  studio.patch(ended, { activity: "idle" });
  studio.sessions.update(STORY_SESSIONS.build.id, ended, {
    tone: "done",
    running: false,
    time: "now",
  });

  // The visitor opens the file from its row, and the tab shows the rendered page.
  const pointed = cursor.point(() => file, ended + 0.4, 0.9);
  scene.at(pointed, () => file.toggleAttribute("data-hover", true));
  const opened = cursor.click(() => file, pointed + 0.3, 0.05);
  scene.mark("file", opened);
  scene.mark("to-file-end", opened - 0.36);
  scene.mark("file-rest", opened + 0.5);
  scene.mark("file-rest-end", opened + 1.15);
  tab.open(opened + 0.1);

  // Expand opens the page in a large dialog.
  const onExpand = cursor.point(() => tab.expand, opened + 1.2, 0.7);
  scene.mark("expand", onExpand);
  scene.mark("expand-rest", onExpand + 0.25);
  scene.mark("expand-rest-end", onExpand + 0.6);
  scene.at(onExpand, () => {
    tab.expand.toggleAttribute("data-hover", true);
    tip.show(tab.expand, EXPAND);
  });
  const expanded = cursor.click(() => tab.expand, onExpand + 0.6, 0.05);
  scene.at(expanded + 0.1, () => {
    tip.hide();
    tab.expand.removeAttribute("data-hover");
  });
  preview.open(expanded + 0.1);
  scene.mark("preview", expanded + 0.35);
  scene.mark("preview-open", expanded + 0.35 + 0.2);
  cursor.hide(expanded + 0.6);

  // The visitor reads the page, then closes the dialog.
  const onClose = cursor.point(() => close, expanded + 3.8, 0.8);
  scene.at(onClose, () => close.toggleAttribute("data-hover", true));
  const closed = cursor.click(() => close, onClose + 0.3, 0.05);
  preview.close(closed + 0.05);
  cursor.hide(closed + 0.5);
  scene.endAt(closed + 1.8);
};
