import { must } from "../../motion/dom";
import type { SceneBuilder } from "../../motion/scene";
import { EASE } from "../../motion/tokens";
import { modelPicker } from "../../replicas/models/model-picker";
import { modelTrigger } from "../../replicas/models/model-trigger";
import { pointer } from "../../replicas/shell/cursor";
import { tooltip } from "../../replicas/ui/tip";
import { modelKey, RUNTIME_LABELS, type RuntimeKind } from "../../sample/models";
import { SPEC_AFTER, SPEC_BEFORE, SPEC_PICKED } from "./sample";

/** Seconds of the drag of the effort thumb, from medium to xhigh. */
const DRAG = 0.9;

/**
 * The role defaults of a repository. The Spec role uses Vega 2 Pro on OpenCode at the start. You
 * open its model picker, which opens on OpenCode, the runtime of the selected model. You select
 * Codex, Claude, and Antigravity in the rail, and each list comes in. You select Gemini 4 Comet,
 * which keeps the effort medium, and drag the effort to xhigh. You close the picker: the four roles
 * use the four runtimes.
 */
export const build: SceneBuilder = (scene) => {
  const root = must(scene.stage, "[data-pane]");
  const card = must(root, '[data-role="spec"]');
  const triggerElement = must(card, "[data-model-trigger]");
  const trigger = modelTrigger(triggerElement);
  const picker = modelPicker(scene, must(card, "[data-picker]"));
  const effort = picker.effort(modelKey(SPEC_AFTER));
  const cursor = pointer(scene, root);
  const tip = tooltip(scene, root);

  // Start: the Spec role uses Vega 2 Pro on OpenCode, and the picker is closed. The options of
  // Gemini 4 Comet wait at the effort medium.
  trigger.set(SPEC_BEFORE);
  picker.reset(SPEC_BEFORE.runtime, modelKey(SPEC_BEFORE));
  effort.reset(SPEC_PICKED.effort);

  // 1. You open the model picker of the Spec role. No model is a favorite, so it opens on the
  //    runtime of the selected model, OpenCode, with the effort and the agent profile of the model.
  const opened = cursor.click(() => triggerElement, 0.6, 0.9);
  scene.mark("open", opened);
  picker.open(opened + 0.05);

  // 2. You point at each runtime of the rail. Its tooltip names it, and a click shows its models.
  const visit = (kind: RuntimeKind, at: number, travel: number): number => {
    const arrived = cursor.point(() => picker.rail(kind), at, travel);
    scene.at(arrived + 0.08, () => tip.show(picker.rail(kind), RUNTIME_LABELS[kind], "right"));
    const clicked = cursor.click(() => picker.rail(kind), arrived + 0.4, 0);
    scene.at(clicked, () => tip.hide());
    picker.show(kind, clicked + 0.05);
    return clicked;
  };
  const codex = visit("codex", opened + 0.75, 0.6);
  const claude = visit("claude", codex + 0.55, 0.35);
  const antigravity = visit("antigravity", claude + 0.55, 0.35);

  // 3. You select Gemini 4 Comet. The trigger shows Antigravity, and the model keeps the effort.
  const picked = cursor.click(() => picker.row(modelKey(SPEC_PICKED)), antigravity + 0.7, 0.7);
  scene.mark("pick", picked);
  picker.select(modelKey(SPEC_PICKED), picked);
  scene.at(picked, () => trigger.set(SPEC_PICKED));

  // 4. You drag the effort thumb from medium to xhigh. The label over the thumb follows it, and
  //    the trigger shows the new effort on release.
  const pressed = cursor.point(effort.thumb, picked + 0.6, 0.6) + 0.1;
  scene.mark("effort", pressed);
  const released = cursor.drag(pressed, DRAG, () => ({
    to: effort.tick(SPEC_AFTER.effort),
    ease: EASE.move,
    ...effort.grab(SPEC_AFTER.effort),
  }));
  scene.at(released + 0.05, () => trigger.set(SPEC_AFTER));

  // 5. A click outside closes the picker. The four roles now use the four runtimes.
  const closed = cursor.click(() => must(root, "[data-section-title]"), released + 0.6, 0.9);
  scene.mark("close", closed);
  picker.close(closed);
  cursor.hide(closed + 0.4);
  scene.endAt(closed + 3.2);
};
