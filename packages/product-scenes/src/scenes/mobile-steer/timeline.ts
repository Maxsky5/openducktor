import { must } from "../../motion/dom";
import { fadeIn, shrinkOut } from "../../motion/effects";
import type { SceneBuilder } from "../../motion/scene";
import { composerDraft } from "../../replicas/mobile/draft";
import { finger } from "../../replicas/mobile/finger";
import { screens } from "../../replicas/mobile/screens";
import { stepList } from "../../replicas/mobile/steps";
import { follow, transcript } from "../../replicas/transcript/rows";
import { MESSAGES } from "./sample";

/** The rows that come in while the scene plays, in order. */
const LATER_ROWS = ["queued", "answer", "readTest", "steered", "keymapTests"];

/** Seconds from a steer to the message in the transcript. */
const DELIVERY = 0.6;

/** Seconds that the agent takes to read a steered message: until its next step. */
const READ = 1.6;

/**
 * The visitor queues and steers messages while the Builder works. The Builder runs the search
 * tests. The visitor types a message, and Send puts it in the Message Queue. A tap opens the
 * queued message, and Steer now sends it to the running turn: the card shows Steering… and goes,
 * and the transcript shows the message as Unread until the agent reads it. The agent answers.
 * The visitor types a second message and taps the zap button, which steers it at once. The markup
 * holds the last frame.
 */
export const build: SceneBuilder = (scene) => {
  const root = must(scene.stage, "[data-root]");
  const steps = stepList(scene, root);
  const phone = screens(scene, root);
  const tap = finger(scene, root).tap;
  const session = phone.screen("session");
  const rows = transcript(scene, session);
  const row = (id: string): HTMLElement => must(session, `[data-row="${id}"]`);
  const draft = composerDraft(scene, session);
  const queue = must(session, "[data-queue]");
  const card = must(queue, "[data-queue-card]");
  const track = must(session, "[data-track]");
  follow(scene, track);

  // Start: the Builder runs the search tests, and the queue is empty.
  phone.only("session");
  for (const id of LATER_ROWS) row(id).hidden = true;
  const tests = must(row("test"), "[data-tool]");
  tests.toggleAttribute("data-running", true);

  /**
   * Shows `id` as a message that the agent reads `READ` seconds later. The transcript scrolls to
   * the message at once, so the composer never hides it.
   */
  const deliver = (id: string, at: number): number => {
    const message = row(id);
    message.toggleAttribute("data-unread", true);
    scene.at(at, () => track.toggleAttribute("data-snap", true));
    rows.show(message, at);
    scene.at(at + READ, () => message.removeAttribute("data-unread"));
    return at + READ;
  };

  // The visitor types a message while the agent works, and Send queues it.
  const focused = tap(() => must(session, "[data-composer]"), 1.3);
  const typed = draft.type(MESSAGES.queued.text, focused + 0.2);
  const queued = tap(() => must(session, "[data-send]"), typed + 0.5);
  draft.send(queued);
  scene.at(queued, () => {
    queue.hidden = false;
    scene.run(fadeIn(queue, 0.25));
  });

  // A tap opens the queued message, and its zap button, Steer now, sends it to the running turn.
  steps.show(1, queued + 0.8);
  const opened = tap(() => card, queued + 2);
  scene.at(opened, () => {
    card.dataset.spread = "true";
  });
  const steered = tap(() => must(card, '[data-queue-action="steer"]'), opened + 1.2);
  scene.at(steered, () => {
    card.dataset.state = "steering";
  });
  const delivered = steered + DELIVERY;
  scene.at(delivered, () => scene.run(shrinkOut(queue, 0.25)));
  scene.at(delivered + 0.3, () => tests.removeAttribute("data-running"));

  // The transcript shows the message as Unread. The agent reads it at its next step and answers.
  steps.show(2, delivered);
  const read = deliver("queued", delivered + 0.05);
  const answered = rows.say(row("answer"), read + 0.3);
  const checked = rows.tool(row("readTest"), answered + 0.2, 0.4);

  // The visitor types a second message. The zap button shows next to Stop and steers it at once.
  steps.show(3, checked + 0.5);
  const typedAgain = draft.type(MESSAGES.steered.text, checked + 1);
  const zapped = tap(() => must(session, '[data-secondary="steer"]'), typedAgain + 0.6);
  draft.send(zapped);
  const readAgain = deliver("steered", zapped + DELIVERY);
  rows.start(row("keymapTests"), readAgain + 0.3);
  scene.endAt(readAgain + 3.6);
};
