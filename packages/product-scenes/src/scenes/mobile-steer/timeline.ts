import { must } from "../../motion/dom";
import { fadeIn, shrinkOut } from "../../motion/effects";
import type { SceneBuilder } from "../../motion/scene";
import { composerDraft } from "../../replicas/mobile/draft";
import { finger } from "../../replicas/mobile/finger";
import { screens } from "../../replicas/mobile/screens";
import { stepList } from "../../replicas/mobile/steps";
import { toolRuns } from "../../replicas/mobile/tool-runs";
import { topButton } from "../../replicas/mobile/top-button";
import { transcript } from "../../replicas/transcript/rows";
import { MESSAGES } from "./sample";

/** The messages that come in while the scene plays, in order. The tool runs show their calls. */
const LATER_ROWS = ["queued", "answer", "steered"];

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
  const runs = toolRuns(scene, session);
  const row = (id: string): HTMLElement => must(session, `[data-row="${id}"]`);
  const draft = composerDraft(scene, session);
  const queue = must(session, "[data-queue]");
  const card = must(queue, "[data-queue-card]");
  topButton(scene, session);

  // Start: the Builder runs the search tests, and the queue is empty.
  phone.only("session");
  for (const id of LATER_ROWS) row(id).hidden = true;
  runs.later("readTest", "keymapTests");
  const endTests = runs.running("test");

  /**
   * Shows `id` as a message that the agent reads `READ` seconds later. The message shows at once
   * at the bottom of the transcript, as a new row of the app.
   */
  const deliver = (id: string, at: number): number => {
    const message = row(id);
    message.toggleAttribute("data-unread", true);
    scene.at(at, () => {
      message.hidden = false;
    });
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
  const opened = tap(() => must(card, "[data-queue-open]"), queued + 2);
  scene.at(opened, () => {
    card.dataset.spread = "true";
  });
  const steered = tap(() => must(card, '[data-queue-action="steer"]'), opened + 1.2);
  scene.at(steered, () => {
    card.dataset.state = "steering";
  });
  const delivered = steered + DELIVERY;
  scene.at(delivered, () => scene.run(shrinkOut(queue, 0.25)));

  // The transcript shows the message as Unread. The tests end, and their run folds, because the
  // message follows it. The agent reads the message at its next step and answers.
  steps.show(2, delivered);
  const read = deliver("queued", delivered + 0.05);
  endTests(delivered + 0.3);
  runs.fold("tests", delivered + 0.3);
  const answered = rows.say(row("answer"), read + 0.3);
  const checked = runs.call("readTest", answered + 0.2, 0.4);

  // The visitor types a second message. The zap button shows next to Stop and steers it at once.
  steps.show(3, checked + 0.5);
  const typedAgain = draft.type(MESSAGES.steered.text, checked + 1);
  const zapped = tap(() => must(session, '[data-secondary="steer"]'), typedAgain + 0.6);
  draft.send(zapped);
  const readAgain = deliver("steered", zapped + DELIVERY);
  runs.fold("testRead", zapped + DELIVERY);
  runs.start("keymapTests", readAgain + 0.3);
  scene.endAt(readAgain + 3.6);
};
