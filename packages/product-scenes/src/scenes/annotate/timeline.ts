import { all, must } from "../../motion/dom";
import { fadeIn, pop } from "../../motion/effects";
import type { SceneBuilder } from "../../motion/scene";
import { browserTab } from "../../replicas/browser/browsing";
import { sessionPanel } from "../../replicas/browser/session-panel";
import { composerActivity, composerDraft } from "../../replicas/shell/composer";
import { pointer } from "../../replicas/shell/cursor";
import { follow, transcript } from "../../replicas/transcript/rows";
import { tooltip } from "../../replicas/ui/tip";
import { ANNOTATE_TIP, ANNOTATION_MESSAGE, ANNOTATIONS } from "./sample";

/**
 * The visitor annotates the page in a browser tab. Annotate turns on the element picker. A click
 * selects an element, and its comment box opens. Save adds a numbered marker, and the counts of
 * Pending annotations and of Send go up. The visitor sends a short message, which carries the
 * annotations, and the Builder changes the page. The dev server updates the page in the tab. A
 * phone stage shows one panel at a time: the visitor annotates one element, goes back to the chat
 * to send, then shows the panel again. The markup holds the last frame.
 */
export const build: SceneBuilder = (scene) => {
  const root = must(scene.stage, "[data-root]");
  const panel = sessionPanel(root);
  const cursor = pointer(scene, root);
  const tip = tooltip(root);
  const browser = browserTab(scene, root, cursor);
  const track = must(root, "[data-track]");
  const rows = transcript(scene, root);
  const setActivity = composerActivity(root);
  const composer = composerDraft(scene, root);
  const badge = must(composer.button, "[data-send-badge]");
  const annotate = browser.tool("annotate");
  const row = (name: string): HTMLElement => must(track, `[data-row="${name}"]`);
  const bottomToggle = must(root, '[data-toggle="bottom"]');
  // A phone stage sends one annotation, so the Builder adds no import link.
  const notes = ANNOTATIONS.slice(0, panel.narrow ? 1 : 2);
  follow(scene, track);

  // Start: the browser tab shows the empty notebook before the fix, and no annotation waits.
  panel.select("browser");
  panel.show("panel");
  // The fade of the strip needs the layout, so it shows with the first frame.
  scene.at(0, () => panel.fit());
  browser.page.dataset.version = "before";
  browser.reset();
  badge.textContent = "";
  for (const name of ["message", "patch", "answer"]) row(name).hidden = true;
  for (const part of all(track, '[data-annotation="2"]')) part.hidden = notes.length < 2;
  must(browser.page, '[data-fn="import-link"]').hidden = notes.length < 2;
  setActivity("idle");

  /** The counts of Pending annotations and of Send. */
  const count = (n: number): void => {
    badge.textContent = n > 0 ? String(n) : "";
    if (n > 0) scene.run(pop(badge, 1.3));
  };

  // Annotate turns on the element picker, and the pointer becomes a crosshair over the page.
  const onAnnotate = cursor.point(() => annotate, 0.3);
  scene.at(onAnnotate + 0.1, () => tip.show(annotate, ANNOTATE_TIP));
  const pressed = cursor.click(() => annotate, onAnnotate + 0.5, 0.05);
  scene.at(pressed, () => {
    tip.hide();
    browser.annotate(true);
  });

  let saved = pressed + 0.1;
  notes.forEach(({ element, label, note }, index) => {
    saved = browser.pick(element, saved + 0.15, label, note, index + 1);
    scene.at(saved, () => count(index + 1));
  });
  // The pointer leaves the page, so it is an arrow again.
  scene.at(saved + 0.15, () => browser.crosshair(false));

  // A phone stage shows the chat again with Back to workspace.
  let ready = saved + 0.2;
  if (panel.narrow) {
    const back = cursor.click(() => panel.back, ready, 0.7);
    scene.at(back, () => panel.show("chat"));
    ready = back + 0.3;
  }

  // The visitor types a short message and sends it. The message carries the annotations, so the
  // markers and the counts go.
  const focused = cursor.click(() => composer.editor, ready, 0.7);
  composer.focus(focused + 0.1);
  const typed = composer.type(ANNOTATION_MESSAGE, focused + 0.25, 22);
  const sent = cursor.click(() => composer.button, typed + 0.1, 0.45);
  composer.send(sent);
  scene.at(sent, () => {
    count(0);
    browser.clear();
    setActivity("working");
  });
  cursor.hide(sent + 0.35);
  rows.show(row("message"), sent + 0.1);

  // The Builder changes the empty state, and the dev server updates the page in the tab.
  const patched = rows.show(row("patch"), sent + 0.8);
  scene.at(patched + 0.3, () => {
    browser.page.dataset.version = "after";
    if (!panel.narrow) scene.run(pop(must(browser.page, '[data-fn="create-note"]'), 1.08));
  });
  const answered = rows.say(row("answer"), patched + 0.6);
  scene.at(answered, () => setActivity("idle"));
  if (!panel.narrow) {
    scene.endAt(answered + 2);
    return;
  }

  // A phone stage shows the panel again with the bottom panel toggle.
  const shown = cursor.click(() => bottomToggle, answered + 0.4, 0.8);
  scene.at(shown, () => {
    panel.show("panel");
    scene.run(fadeIn(browser.page, 0.25));
  });
  cursor.hide(shown + 0.4);
  scene.endAt(shown + 2.2);
};
