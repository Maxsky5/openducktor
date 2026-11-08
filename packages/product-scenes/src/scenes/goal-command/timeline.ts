import { must } from "../../motion/dom";
import { designPixel, pop, riseIn } from "../../motion/effects";
import type { SceneBuilder } from "../../motion/scene";
import { typeText } from "../../motion/text";
import { composerActivity, composerDraft } from "../../replicas/shell/composer";
import { pointer } from "../../replicas/shell/cursor";
import { keystrokes } from "../../replicas/shell/keystrokes";
import { composerMenu } from "../../replicas/studio/composer-menu";
import { goalRow } from "../../replicas/studio/goal-row";
import { follow, transcript } from "../../replicas/transcript/rows";
import { OBJECTIVE, PAUSE, QUERY } from "./sample";

/** The rows of the goal turn, which come after the goal message. */
const LATER_ROWS = ["goal", "read", "fix", "test", "run", "final"];

/**
 * The goal command: the visitor types /go, and the slash menu shows /goal with its hints. Enter
 * puts the goal chip in the draft, and the objective follows it. Enter sends the message. The
 * transcript shows it with the chip, the goal row rises, and the agent works. While the goal drives
 * the work, /goal pause applies at once: the row shows Paused with Resume goal, and the agent ends
 * its turn without a next one. The markup holds the last frame.
 */
export const build: SceneBuilder = (scene) => {
  const root = must(scene.stage, "[data-root]");
  const track = must(root, "[data-track]");
  const composer = composerDraft(scene, root);
  const chip = must(composer.editor, "[data-chip]");
  const row = (name: string): HTMLElement => must(track, `[data-row="${name}"]`);
  const setActivity = composerActivity(root);
  const rows = transcript(scene, root);
  const cursor = pointer(scene, root);
  const keys = keystrokes(scene);
  const slash = composerMenu(root, "slash");
  const goal = goalRow(scene, root);
  follow(scene, track);

  // Start: the earlier turn ended, the session has no goal, and the draft is empty.
  for (const name of LATER_ROWS) row(name).hidden = true;
  slash.close();
  goal.reset("active");
  setActivity("idle");

  /**
   * Types the slash query, picks /goal with Enter, and types `text` after the chip. Returns the
   * time when the text ends.
   */
  const goalDraft = (at: number, text: string): number => {
    const queried = composer.type(QUERY, at, 10);
    scene.at(queried, () => {
      slash.open();
      slash.filter(QUERY.slice(1));
      scene.run(riseIn(must(root, '[data-menu="slash"]'), 6 * designPixel(root), 0.25));
    });
    const picked = queried + 1.1;
    keys.press(["Enter"], picked, picked + 0.6);
    scene.at(picked, () => {
      slash.close();
      composer.typed.textContent = "";
      chip.hidden = false;
      scene.run(pop(chip, 1.08));
    });
    return typeText(scene, composer.typed, text, picked + 0.4, { charsPerSecond: 40 });
  };

  /** Enter sends the draft at `at`. The draft clears. */
  const sendDraft = (at: number): void => {
    keys.press(["Enter"], at, at + 0.6);
    composer.send(at);
    scene.at(at, () => {
      chip.hidden = true;
    });
  };

  // The visitor clicks the composer and sets the goal.
  const focused = cursor.click(() => composer.editor, 0.3, 0.7);
  cursor.hide(focused + 0.3);
  const written = goalDraft(focused + 0.2, OBJECTIVE);
  const sent = written + 0.4;
  sendDraft(sent);

  // The message shows with the goal chip, the goal row rises, and the agent works on the goal.
  rows.show(row("goal"), sent + 0.15);
  goal.show(sent + 0.5);
  scene.at(sent + 0.3, () => setActivity("working"));
  const read = rows.tool(row("read"), sent + 0.9, 0.3);
  rows.show(row("fix"), read + 0.4);
  rows.show(row("test"), read + 0.8);
  const testing = read + 1.2;
  const finishTests = rows.start(row("run"), testing);

  // While the goal drives the work, /goal pause applies at once. The row shows Paused.
  const paused = goalDraft(testing + 0.3, PAUSE) + 0.35;
  sendDraft(paused);
  goal.status(paused + 0.3, "paused");

  // The tests end, and the agent ends its turn. The paused goal starts no next turn.
  finishTests(paused + 0.9);
  const ended = rows.say(row("final"), paused + 1.2);
  scene.at(ended, () => setActivity("idle"));
  scene.endAt(ended + 2.6);
};
