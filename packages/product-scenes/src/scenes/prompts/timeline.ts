import { must } from "../../motion/dom";
import { fadeIn, growIn, pop } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import { EASE } from "../../motion/tokens";
import { typeText } from "../../motion/text";
import type { SceneBuilder } from "../../motion/scene";
import { pointer } from "../../replicas/shell/cursor";
import { APPEND_TEXT } from "./sample";

/**
 * The visitor opens the Spec, Plan, Build workflow from the first screen of the prompts, then
 * its built-in QA Kickoff prompt.
 * The visitor adds append instructions for every repository. The first letter turns the append on
 * and gives the prompt the Appended badge. The final text shows the built-in
 * prompt, then the global append as the visitor types it. The visitor saves. The markup holds the
 * frame before the save.
 */
export const build: SceneBuilder = (scene) => {
  const root = must(scene.stage, "[data-prompts]");
  const overview = must(root, "[data-overview]");
  const home = must(overview, "[data-home]");
  const workflowRow = must(home, "[data-workflow-target]");
  const workflowPage = must(overview, "[data-workflow-page]");
  const target = must(overview, "[data-target]");
  const pane = must(root, "[data-editor]");
  const paneContent = must(pane, "[data-editor-inner]");
  const editor = must(root, "[data-textarea]");
  const typed = must(editor, "[data-typed]");
  const caret = must(editor, "[data-caret]");
  const placeholder = must(editor, "[data-placeholder]");
  const controls = must(root, "[data-append-controls]");
  // The editor header shows the status of the prompt.
  const appendedBadge = must(root, "[data-badge-appended]");
  const appendPart = must(root, "[data-append-part]");
  const preview = must(appendPart, "[data-append-preview]");
  const cancel = must(root, "[data-cancel]");
  const save = must(root, "[data-save]");
  const saveLabel = must(save, "[data-save-label]");
  const cursor = pointer(scene, root);

  // Start: the first screen. The prompt has no append, so it has no badge.
  overview.hidden = false;
  pane.hidden = true;
  home.hidden = false;
  workflowPage.hidden = true;
  gsap.set(workflowPage, { clearProps: "transform" });
  workflowRow.removeAttribute("data-hover");
  target.removeAttribute("data-hover");
  pane.removeAttribute("data-scrolled");
  controls.hidden = true;
  typed.textContent = "";
  placeholder.hidden = false;
  appendedBadge.hidden = true;
  appendPart.hidden = true;
  preview.textContent = "";

  // The visitor opens the workflow. Its page replaces the first screen.
  const switched = cursor.click(() => workflowRow, 0.9);
  scene.at(switched - 0.25, () => workflowRow.toggleAttribute("data-hover", true));
  scene.at(switched, () => {
    workflowRow.removeAttribute("data-hover");
    home.hidden = true;
    workflowPage.hidden = false;
    scene.run(fadeIn(workflowPage, 0.25));
  });

  // The workflow page scrolls until QA Kickoff shows at the bottom of the stage.
  const scrolledToTarget = switched + 0.6;
  scene.at(scrolledToTarget, () => {
    const hiddenBelow =
      target.getBoundingClientRect().bottom - overview.getBoundingClientRect().bottom;
    if (hiddenBelow > 0)
      scene.run(gsap.to(workflowPage, { y: -hiddenBelow - 16, duration: 0.6, ease: EASE.gentle }));
  });

  // The visitor opens QA Kickoff. Its editor replaces the workflow page.
  const opened = cursor.click(() => target, scrolledToTarget + 1.2);
  scene.at(opened - 0.25, () => target.toggleAttribute("data-hover", true));
  scene.at(opened, () => {
    overview.hidden = true;
    pane.hidden = false;
    scene.run(fadeIn(pane, 0.25));
  });

  const focused = cursor.click(() => editor, opened + 0.8);
  scene.at(focused, () => editor.toggleAttribute("data-focus", true));

  // The first letter turns the append on, so the badge and the final text change with it.
  const start = focused + 0.4;
  scene.at(start, () => {
    editor.toggleAttribute("data-typing", true);
    placeholder.hidden = true;
    controls.hidden = false;
    scene.run(fadeIn(controls, 0.25));
    appendedBadge.hidden = false;
    scene.run(pop(appendedBadge, 1.2));
    appendPart.hidden = false;
    scene.run(growIn(appendPart, 0.35));
  });
  const end = typeText(scene, typed, APPEND_TEXT, start, {
    charsPerSecond: 30,
    onText: (text) => {
      preview.textContent = text;
    },
  });
  scene.at(end, () => editor.removeAttribute("data-typing"));

  // The visitor scrolls the editor to its end and reads the final text with the append.
  const scrolled = end + 0.5;
  scene.at(scrolled, () => {
    const top = paneContent.offsetTop;
    pane.toggleAttribute("data-scrolled", true);
    scene.run(
      gsap.fromTo(
        paneContent,
        { y: top - paneContent.offsetTop },
        { y: 0, duration: 0.8, ease: EASE.gentle, clearProps: "transform" },
      ),
    );
  });

  // The dialog closes when the save ends. The loop fades out at that moment.
  const saved = cursor.click(() => save, scrolled + 2);
  scene.at(saved, () => {
    editor.removeAttribute("data-focus");
    caret.hidden = true;
    saveLabel.textContent = "Saving…";
    save.toggleAttribute("data-saving", true);
    save.toggleAttribute("data-disabled", true);
    cancel.toggleAttribute("data-disabled", true);
  });
  cursor.hide(saved + 0.5);
  scene.endAt(saved + 1.1);
};
