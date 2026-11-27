import { must } from "../../motion/dom";
import { fadeIn } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import type { Scene, SceneBuilder } from "../../motion/scene";
import { typeText } from "../../motion/text";
import { EASE } from "../../motion/tokens";
import { pointer } from "../../replicas/shell/cursor";
import { toastIn } from "../../replicas/shell/notify";
import { modal } from "../../replicas/studio/modal";
import { canvasView } from "../../replicas/workflows/canvas-view";
import { detailsPanel } from "../../replicas/workflows/details";
import { type EmphasisMap, workflowFlow } from "../../replicas/workflows/flow";
import { editorHeader } from "../../replicas/workflows/header";
import type { Emphasis } from "../../replicas/workflows/model";
import { outlinePanel } from "../../replicas/workflows/outline";
import { problemsBar } from "../../replicas/workflows/problems-bar";
import {
  BUTTONS,
  FRAMES,
  LINES,
  NEW_LINE,
  NEW_STATE,
  READINESS,
  REVEAL,
  STATE_LIST,
  STATES,
  VERSION,
} from "./sample";

/** Every box and line dims while another element is selected. */
const DIMMED: EmphasisMap = Object.fromEntries(
  [...STATE_LIST, ...LINES].map(({ id }): [string, Emphasis] => [id, "dimmed"]),
);

/** The emphasis of the canvas while the new state is selected: it links nothing yet. */
const STATE_SELECTED: EmphasisMap = { ...DIMMED, [NEW_STATE.id]: "selected" };

/** The emphasis while the new transition is selected: its line and the two states that it links. */
const LINE_SELECTED: EmphasisMap = {
  ...DIMMED,
  [STATES.fixing.id]: "related",
  [NEW_STATE.id]: "related",
  [NEW_LINE]: "selected",
};

/** Seconds that the visitor reads a new step before the pointer moves on. */
const READ = 0.8;

/** Seconds that the publication runs before the dialog closes. */
const PUBLISHING = 0.5;

/** Seconds from the end of the publication to the new editor of the published version. */
const RELOAD = 0.2;

/** Seconds that a box or a line takes to its new place. */
const MOVE = 0.3;

/** Seconds of the end hold on the published workflow. */
const HOLD = 2.3;

/**
 * Quick fix, version 1, is published. The visitor adds the state Test with Add a state: the
 * dialog takes its name, and the box takes the place of Done, which moves one row down. The draft
 * saves, and the details of Test warn that no task can reach it. The visitor drags a line from
 * Fixing onto Test. The new transition has no trigger, so its line is dotted and its details warn.
 * Add a button gives it a board button, and the draft is ready. The visitor publishes it: the
 * editor opens version 2 again in auto layout, and a toast confirms the publication. The markup
 * holds the last frame.
 */
export const build: SceneBuilder = (scene: Scene) => {
  const root = must(scene.stage, "[data-root]");
  const cursor = pointer(scene, root);
  const view = canvasView(root);
  const flow = workflowFlow(root, cursor);
  const header = editorHeader(scene, root);
  const outline = outlinePanel(scene, root);
  const bar = problemsBar(scene, root);
  const details = detailsPanel(scene, root, view);
  const addDialog = modal(scene, root, must(root, "[data-add-state-dialog]"));
  const publishDialog = modal(scene, root, must(root, "[data-publish-dialog]"));
  const nameInput = must(root, "[data-name-input]");
  const typed = must(nameInput, "[data-typed]");
  const create = must(root, "[data-create]");
  const confirm = must(root, "[data-publish-dialog] [data-confirm]");
  const toast = must(root, "[data-toasts] > .toast");
  const testKey = `state:${NEW_STATE.id}`;
  const lineKey = `event:${NEW_LINE}`;

  // Start: version 1 is published, with no selection. Test and its transition do not exist yet.
  flow.reset(FRAMES.published, NEW_STATE.id, NEW_LINE);
  view.showStart();
  header.reset(VERSION);
  outline.reset([testKey, lineKey], {
    states: STATE_LIST.length - 1,
    transitions: LINES.length - 1,
    buttons: BUTTONS.before,
  });
  bar.reset(READINESS.published);
  details.reset();
  toast.hidden = true;
  typed.textContent = "";
  nameInput.removeAttribute("data-filled");
  create.toggleAttribute("data-disabled", true);
  scene.mark("published", 0.2);

  // 1. Add a state opens its dialog. The visitor types the name and clicks Create.
  const added = cursor.click(() => must(root, "[data-add-state]"), 0.5, 0.8);
  scene.mark("add-state", added);
  addDialog.open(added + 0.05);
  scene.at(added + 0.05, () => typed.toggleAttribute("data-typing", true));
  const typedEnd = typeText(scene, typed, NEW_STATE.label, added + 0.45, {
    charsPerSecond: 9,
    onText: (text) => {
      nameInput.toggleAttribute("data-filled", text !== "");
      create.toggleAttribute("data-disabled", text === "");
    },
  });
  const created = cursor.click(() => create, typedEnd + 0.15, 0.5);
  scene.mark("create", created);

  // 2. The dialog closes, and the editor adds the state. Done moves one row down and Mark fixed
  //    goes around the new place, then the box of the new state shows there. The editor selects
  //    the state: its details open, and the canvas fits the workflow again in its narrower width.
  //    The draft saves.
  addDialog.close(created + 0.05);
  const placed = created + 0.22;
  scene.at(placed, () => {
    typed.removeAttribute("data-typing");
    scene.run(flow.glide(STATES.closed.id, FRAMES.added.positions.closed, MOVE));
    scene.run(flow.morph("mark_fixed", FRAMES.added.routes.mark_fixed, MOVE));
    outline.setCount("states", STATE_LIST.length);
  });
  outline.add(testKey, placed);
  bar.show(READINESS.warning, placed);
  header.edit(placed);
  scene.at(placed + MOVE - 0.1, () => {
    const box = flow.node(NEW_STATE.id);
    box.hidden = false;
    flow.place(NEW_STATE.id, FRAMES.added.positions.test);
    scene.run(fadeIn(box, 0.15));
  });
  const selected = placed + MOVE + 0.15;
  scene.at(selected, () => {
    flow.emphasize(STATE_SELECTED);
    outline.select(testKey);
    outline.setProblem(testKey, true);
  });
  details.open("state", selected, () => scene.run(view.fitTo(FRAMES.added.content, REVEAL.state)));

  // 3. The visitor drags a line from the dot under Fixing onto Test. The box under the pointer
  //    shows its dots, and the dot under the pointer takes the selection colour.
  const fixingDot = (): HTMLElement => flow.dot(STATES.fixing.id, "bottom");
  const reached = cursor.point(() => flow.aim(fixingDot()), selected + 0.3 + READ, 0.8);
  scene.at(reached - 0.3, () => {
    flow.hover(STATES.fixing.id, true);
    flow.node(STATES.fixing.id).dataset.emphasis = "normal";
  });
  scene.at(reached, () => {
    fixingDot().toggleAttribute("data-active", true);
    cursor.crosshair(true);
  });
  scene.mark("connect", reached);
  const dropped = flow.drag(
    FRAMES.connected.positions.fixing,
    { id: NEW_STATE.id, at: FRAMES.connected.positions.test },
    reached + 0.2,
    0.8,
  );

  // 4. The drop adds the transition and selects it. Its line is dotted, its label is dashed with a
  //    warning, and its details say that nothing triggers it.
  scene.at(dropped, () => {
    fixingDot().removeAttribute("data-active");
    flow.hover(STATES.fixing.id, false);
    cursor.crosshair(false);
    // Two lines now leave the bottom of Fixing, so Mark fixed takes the next place on that side.
    flow.route(NEW_LINE, FRAMES.connected.routes.move_to_test);
    scene.run(flow.morph("mark_fixed", FRAMES.connected.routes.mark_fixed, 0.2));
    flow.showLine(NEW_LINE, true);
    scene.run(view.revealTo(FRAMES.connected.content, REVEAL.line));
    flow.emphasize(LINE_SELECTED);
    flow.showGrips(true);
    scene.run(
      gsap.fromTo(
        flow.label(NEW_LINE),
        { autoAlpha: 0, scale: 0.9 },
        {
          autoAlpha: 1,
          scale: 1,
          duration: 0.2,
          ease: EASE.enter,
          clearProps: "opacity,visibility,transform",
        },
      ),
    );
    outline.setCount("transitions", LINES.length);
    outline.setProblem(testKey, false);
    outline.setProblem(lineKey, true);
    outline.select(lineKey);
  });
  outline.add(lineKey, dropped);
  details.open("event", dropped);
  header.edit(dropped);

  // 5. Add a button gives the transition a board button. The line turns solid, the label shows the
  //    button icon, and the draft is ready to publish. The pointer then moves off the details. On
  //    a phone stage, the details first scroll to the button.
  const addButton = (): HTMLElement => must(root, "[data-add-button]");
  details.reveal(addButton, dropped + READ - 0.2);
  const triggered = cursor.click(addButton, dropped + 0.3 + READ, 0.75);
  scene.mark("trigger", triggered);
  // The click ring ends on the button before the details render again.
  const buttonAdded = triggered + 0.3;
  scene.at(buttonAdded, () => {
    flow.setTriggered(NEW_LINE, true);
    scene.run(
      gsap.to(flow.label(NEW_LINE), {
        "--lw": FRAMES.triggered.routes.move_to_test.label.width,
        duration: 0.2,
        ease: EASE.move,
      }),
    );
    outline.setTriggered(lineKey, true);
    outline.setProblem(lineKey, false);
    outline.setCount("buttons", BUTTONS.after);
  });
  cursor.point(() => flow.aimAt(0.9, 0.45), triggered + 0.08, 0.6);
  details.trigger(buttonAdded);
  bar.show(READINESS.ready, buttonAdded);
  const saved = header.edit(buttonAdded);

  // 6. The visitor publishes the draft. The dialog offers to move the task on version 1.
  const publishing = cursor.click(() => must(header.publish, ".ui-button"), saved + 0.65, 0.75);
  scene.mark("publish", publishing);
  publishDialog.open(publishing + 0.05);
  const confirmed = cursor.click(() => confirm, publishing + 0.3 + 1.0, 0.6);
  scene.at(confirmed + 0.05, () => confirm.toggleAttribute("data-busy", true));

  // 7. The publication ends, and the dialog closes. The editor reads the workflow again and opens
  //    version 2: no selection, the boxes in auto layout, and a canvas fit in its full width, clear
  //    of the toast that confirms the publication.
  const done = confirmed + PUBLISHING;
  scene.mark("published-again", done);
  publishDialog.close(done);
  const reloaded = done + RELOAD;
  const closed = details.close(reloaded);
  // The toast comes in once the details are gone, so no text shows through them.
  scene.at(closed, () => {
    toast.hidden = false;
    scene.run(toastIn(toast));
  });
  header.published(reloaded, VERSION + 1);
  bar.show(READINESS.published, reloaded);
  scene.at(reloaded, () => {
    outline.select(null);
    flow.emphasize({});
    flow.showGrips(false);
  });
  scene.at(closed, () => {
    for (const id of [NEW_STATE.id, STATES.closed.id])
      scene.run(flow.glide(id, FRAMES.republished.positions[id], MOVE));
    const { routes } = FRAMES.republished;
    scene.run(flow.morph("mark_fixed", routes.mark_fixed, MOVE));
    scene.run(flow.morph(NEW_LINE, routes.move_to_test, MOVE));
    scene.run(view.fitToMarkup(FRAMES.republished.content, MOVE));
  });
  cursor.hide(done + 0.3);
  scene.endAt(reloaded + 0.53 + HOLD);
};
