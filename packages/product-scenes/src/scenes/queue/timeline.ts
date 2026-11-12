import { must } from "../../motion/dom";
import type { SceneBuilder } from "../../motion/scene";
import { composerActivity, composerDraft } from "../../replicas/shell/composer";
import { pointer } from "../../replicas/shell/cursor";
import { keystrokes } from "../../replicas/shell/keystrokes";
import { queueStack } from "../../replicas/studio/queue";
import { follow, transcript } from "../../replicas/transcript/rows";
import { QUEUED } from "./sample";

/** Seconds that the stack keeps the whole messages while its cards shrink back: --queue-close. */
const SHRINK = 0.25;

/**
 * Queued messages while the Builder works. The developer types two messages, and Enter queues
 * each one in the stack above the composer. The pointer opens the stack, and Steer now sends the
 * newest message to the running work. When the turn ends, the queue sends the next message by
 * itself, and a new turn starts. The markup holds the open stack with the hint of Steer now.
 */
export const build: SceneBuilder = (scene) => {
  const root = must(scene.stage, "[data-root]");
  const track = must(root, "[data-track]");
  const composer = composerDraft(scene, root);
  const row = (name: string): HTMLElement => must(track, `[data-row="${name}"]`);
  const stack = queueStack(root);
  const setActivity = composerActivity(root);
  const rows = transcript(scene, root);
  const cursor = pointer(scene, root);
  const keys = keystrokes(scene);
  const steerButton = (): HTMLElement =>
    must(stack.card(QUEUED.steer.id), '[data-queue-action="steer"]');
  follow(scene, track);

  // Start: the agent runs the search tests, and the queue is empty.
  stack.clear();

  /** Types `text` in the composer, and Enter queues it as the card `id`. Returns the time of Enter. */
  const queue = (id: string, text: string, at: number): number => {
    const entered = composer.type(text, at, 24) + 0.3;
    keys.press(["Enter"], entered, entered + 0.7);
    composer.send(entered + 0.05);
    scene.at(entered + 0.05, () => stack.add(id));
    return entered;
  };

  // The developer clicks the composer and queues two messages while the agent works.
  const focused = cursor.click(() => composer.editor, 0.3, 0.7);
  cursor.hide(focused + 0.3);
  const first = queue(QUEUED.next.id, QUEUED.next.text, focused + 0.2);
  const second = queue(QUEUED.steer.id, QUEUED.steer.text, first + 0.6);

  // The pointer rests on the stack, and the stack opens. The front card shows its actions.
  const rested = cursor.point(() => stack.card(QUEUED.steer.id), second + 0.6, 0.7);
  scene.at(rested + 0.1, () => {
    stack.spread("open");
    stack.hover(QUEUED.steer.id);
  });
  const onSteer = cursor.point(steerButton, rested + 0.6, 0.4);
  scene.at(onSteer, () => stack.hint(QUEUED.steer.id, true));

  // Steer now sends the message to the running work. The card leaves, and the transcript shows it.
  const steered = cursor.click(steerButton, onSteer + 0.8, 0.05);
  scene.at(steered + 0.05, () => {
    stack.hint(QUEUED.steer.id, false);
    stack.setState(QUEUED.steer.id, "steering");
  });
  const delivered = steered + 0.6;
  scene.at(delivered, () => {
    stack.leave(QUEUED.steer.id);
    stack.hover(null);
    stack.spread("closing");
  });
  scene.at(delivered + SHRINK, () => {
    stack.remove(QUEUED.steer.id);
    stack.spread("closed");
  });
  cursor.hide(delivered);
  rows.show(row("steer"), delivered + 0.05);

  // The search tests end. The agent reads the message and adds the keymap tests to the run.
  scene.at(delivered + 0.5, () =>
    must(row("search-tests"), "[data-tool]").removeAttribute("data-running"),
  );
  const answered = rows.say(row("ack"), delivered + 0.7);
  const tested = rows.tool(row("keymap-tests"), answered + 0.2, 0.9);

  // The final message ends the turn.
  const ended = rows.say(row("final"), tested + 0.3);
  scene.at(ended, () => setActivity("idle"));

  // The queue sends the next message by itself, and a new turn starts.
  const sending = ended + 0.4;
  scene.at(sending, () => stack.setState(QUEUED.next.id, "sending"));
  const sent = sending + 0.5;
  scene.at(sent, () => {
    stack.leave(QUEUED.next.id);
    setActivity("working");
  });
  scene.at(sent + SHRINK, () => stack.remove(QUEUED.next.id));
  rows.show(row("next"), sent + 0.05);
  rows.start(row("help-search"), sent + 0.6);
  scene.endAt(sent + 3.5);
};
