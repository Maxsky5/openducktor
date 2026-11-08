import { must } from "../../motion/dom";
import { fadeIn, growIn, pop } from "../../motion/effects";
import type { SceneBuilder } from "../../motion/scene";
import { composerActivity } from "../../replicas/shell/composer";
import { pointer } from "../../replicas/shell/cursor";
import { sessionList } from "../../replicas/shell/nav-list";
import { studioRequests } from "../../replicas/studio/requests";
import { questionCard } from "../../replicas/transcript/question";
import { follow, transcript } from "../../replicas/transcript/rows";
import { SPEC_QUESTIONS } from "../../sample/question";
import { SPEC_ENTRY, START_NAV, SYNC_ENTRY } from "./sample";

/**
 * Answer a question. A Builder session shows, and the Spec session waits in Needs you. You open
 * the Spec session from the sidebar and pick an answer for each question. A single-choice answer
 * opens the next question, and the last one opens the Summary tab. Confirm Answers sends the
 * answers: the card closes, the agent continues, and the session moves to Running. A phone stage
 * shows the sidebar, then the session, then the sidebar again. The markup holds the open session
 * with its first question.
 */
export const build: SceneBuilder = (scene) => {
  const root = must(scene.stage, "[data-root]");
  const syncPage = must(root, '[data-page="sync"]');
  const specPage = must(root, '[data-page="spec"]');
  const row = (name: string): HTMLElement => must(specPage, `[data-row="${name}"]`);
  const card = must(specPage, "[data-request]");
  const specStep = must(specPage, '[data-step="spec"]');
  const sessions = sessionList(scene, root);
  const cursor = pointer(scene, root);
  const rows = transcript(scene, root);
  const requests = studioRequests(scene, specPage, cursor);
  const setActivity = composerActivity(specPage);
  const form = questionCard(scene, card, cursor);
  const resetFollow = follow(scene, must(specPage, "[data-track]"));
  /** The pane that a phone stage shows. */
  const setPane = (pane: "sidebar" | "main"): void => {
    root.dataset.pane = pane;
  };

  // Start: the Builder session shows, and the Spec session waits in Needs you.
  sessions.place(START_NAV);
  syncPage.hidden = false;
  specPage.hidden = true;
  setPane("sidebar");

  // You select the Spec session in Needs you, and its page opens with the question card.
  const opened = cursor.click(() => must(root, `[data-nav-entry="${SPEC_ENTRY.id}"]`), 0.8, 1.1);
  sessions.update(SPEC_ENTRY.id, opened, { selected: true });
  sessions.update(SYNC_ENTRY.id, opened, { selected: false });
  scene.at(opened, () => {
    syncPage.hidden = true;
    specPage.hidden = false;
    resetFollow();
    setPane("main");
    scene.run(fadeIn(specPage, 0.2));
  });

  // You pick an answer for each question. The last answer opens the Summary tab.
  let picked = opened;
  for (const [index, question] of SPEC_QUESTIONS.entries()) {
    picked = form.choose(question.answer, index, picked + (index === 0 ? 1 : 1.3), 0.9);
    form.next(index, picked + 0.35);
  }

  // Confirm Answers sends the answers.
  const confirmed = form.confirm(picked + 1.8, 0.8);
  const resumed = confirmed + 0.6;
  requests.undock(card, resumed);
  scene.at(resumed, () => {
    must(row("question"), "[data-tool]").removeAttribute("data-running");
    row("answers").hidden = false;
    scene.run(growIn(row("answers")));
    specStep.dataset.tone = "in_progress";
    scene.run(pop(specStep, 1.06));
    setActivity("working");
  });
  cursor.hide(resumed + 0.2);

  // The agent continues, and the session leaves Needs you for Running.
  sessions.update(SPEC_ENTRY.id, resumed, {
    attention: undefined,
    running: true,
    tone: "in_progress",
  });
  rows.start(row("next"), resumed + 0.7);
  scene.at(resumed + 1.3, () => setPane("sidebar"));
  scene.endAt(resumed + 3.7);
};
