import { must } from "../../motion/dom";
import type { SceneBuilder } from "../../motion/scene";
import { finger } from "../../replicas/mobile/finger";
import { pendingQuestion } from "../../replicas/mobile/pending-question";
import { rail } from "../../replicas/mobile/rail";
import { sessionGroups } from "../../replicas/mobile/session-groups";
import { screens } from "../../replicas/mobile/screens";
import { stepList } from "../../replicas/mobile/steps";
import { toolRuns } from "../../replicas/mobile/tool-runs";
import { topButton } from "../../replicas/mobile/top-button";
import { composerActivity } from "../../replicas/shell/composer";
import { transcript } from "../../replicas/transcript/rows";
import { PIN_SPEC, QUESTION, RAIL, START_SESSIONS } from "./sample";

/** Seconds that the visitor reads the question before the tap on an answer. */
const READ = 2.6;

/** Seconds from the choice to the tap on Confirm Answers. */
const CONFIRM = 1;

/** Seconds that the host takes to confirm the answer. */
const SUBMIT = 0.45;

/** Seconds from the answer to the first words of the reply of the agent. */
const RESUME = 0.8;

/**
 * The visitor answers a Structured Question on the phone. The Sessions tab shows the waiting Spec
 * session in Needs you, and the badge counts it. A tap opens the session: the question waits in
 * the transcript, and its card shows above the composer. The visitor chooses an answer and taps
 * Confirm Answers. The card shows Submitting… until the host takes the answer, then the pending
 * list goes, the question in the transcript shows the answer, and the Spec agent replies and runs
 * a command. The markup holds the last frame.
 */
export const build: SceneBuilder = (scene) => {
  const root = must(scene.stage, "[data-root]");
  const steps = stepList(scene, root);
  const phone = screens(scene, root);
  const tap = finger(scene, root).tap;
  const list = sessionGroups(scene, root);
  const session = phone.screen("session");
  const rows = transcript(scene, session);
  const runs = toolRuns(scene, session);
  const question = pendingQuestion(scene, session, tap);
  const reply = must(session, '[data-row="reply"]');
  const setActivity = composerActivity(session);
  const setRail = rail(session);
  topButton(scene, session);

  // Start: the Spec agent waits for its answer, and the Sessions tab shows it in Needs you.
  phone.only("sessions");
  list.place(START_SESSIONS);
  question.wait();
  setActivity("waiting");
  setRail("spec", RAIL.waiting.spec);
  reply.hidden = true;
  runs.later("store");
  scene.mark("needs-you", 0.6);

  // The visitor opens the session from Needs you. The card of the question is above the composer.
  steps.show(1, 1.4);
  const opened = tap(() => list.row(PIN_SPEC), 2.6);
  const shown = phone.push("sessions", "session", opened);
  scene.mark("open", opened);
  scene.mark("question", shown);

  // The visitor reads the question and chooses an answer. Confirm Answers turns on.
  steps.show(2, shown + 0.2);
  const chosen = question.choose(QUESTION.answer, shown + READ);
  scene.mark("choose", chosen);

  // Confirm Answers sends the answer, and the card shows its progress until the host takes it.
  steps.show(3, chosen + 0.3);
  const sent = question.confirm(chosen + CONFIRM);
  scene.mark("submit", sent);

  // The host takes the answer: the card goes, the question shows the answer, and the Spec agent
  // works again.
  const answered = sent + SUBMIT;
  question.answer(answered);
  scene.at(answered, () => {
    setActivity("working");
    setRail("spec", RAIL.working.spec);
  });
  scene.mark("answered", answered);

  // The Spec agent replies and reads the note store.
  steps.show(4, answered + 0.2);
  const resumed = answered + RESUME;
  scene.mark("resumed", resumed);
  const said = rows.say(reply, resumed);
  runs.start("store", said + 0.3);
  scene.endAt(said + 3);
};
