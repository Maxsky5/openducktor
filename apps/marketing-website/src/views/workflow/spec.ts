import { must } from "../../motion/dom";
import { growIn } from "../../motion/effects";
import type { Scene } from "../../motion/scene";
import { studioWindow } from "../../replica/studio/studio";
import { questionCard } from "../../replica/transcript/question";
import { DOCUMENTS, FRAMES, SPEC_SESSION } from "../../sample/studio";
import type { RowId } from "../../sample/transcripts";
import { endTurn, saveDocument } from "./session";

/** The templates of SpecStep.astro. */
export type SpecTemplate = "question";

/**
 * Spec: the Spec agent reads the task, asks two questions, and saves the specification with
 * your answers. The chapter starts a new task, so it starts from an empty document.
 */
export function spec(scene: Scene<SpecTemplate>): void {
  const studio = studioWindow(scene);
  const row = (id: RowId<"spec">): HTMLElement => studio.row("spec", id);
  const question = row("question");
  const answers = must(question, "[data-answers]");

  studio.hideTurns("spec");
  answers.hidden = true;
  // The session starts with the context of the kickoff prompt.
  const start = { ...SPEC_SESSION, used: 3.2 };
  studio.apply(
    {
      ...FRAMES.spec,
      tones: ["in_progress", "blocked", "blocked", "blocked"],
      action: "Start Spec",
      session: start,
    },
    "working",
  );
  studio.panels.setDocument(DOCUMENTS.spec, false);

  studio.rows.show(row("kickoff"), 0.3);
  studio.rows.tool(row("read-task"), 0.9, 0.35);
  studio.rows.tool(row("search"), 1.5, 0.45);
  studio.rows.tool(row("read-dialog"), 2.1, 0.3);

  // The agent asks two questions, and the session waits for the answers.
  const asked = 2.7;
  const answered = studio.rows.start(question, asked);
  const card = studio.requests.dock("question", asked + 0.3);
  studio.patch(asked + 0.3, {
    activity: "waiting",
    tones: ["waiting_input", "blocked", "blocked", "blocked"],
  });

  // You answer both questions and confirm the answers.
  const form = questionCard(scene, card, studio.cursor);
  const first = form.choose("Cmd+K / Ctrl+K", 0, asked + 1.5, 1);
  form.next(0, first + 0.35);
  const second = form.choose("No, ignore it in text fields", 1, first + 1.4, 0.8);
  form.next(1, second + 0.35);
  const confirmed = form.confirm(second + 1.5, 0.7);

  const resumed = confirmed + 0.6;
  studio.requests.undock(card, resumed);
  studio.patch(resumed, {
    activity: "working",
    tones: ["in_progress", "blocked", "blocked", "blocked"],
  });
  answered(resumed);
  scene.at(resumed, () => {
    answers.hidden = false;
    scene.run(growIn(answers));
  });
  studio.cursor.hide(resumed + 0.3);

  // The agent saves the specification. The Planner becomes available.
  const saved = saveDocument(
    studio,
    row("set-spec"),
    resumed + 1,
    DOCUMENTS.spec.updated,
    { tones: ["in_progress", "available", "blocked", "blocked"], action: "Start Planner" },
    2.2,
  );
  endTurn(
    studio,
    row("final"),
    saved + 2.4,
    { tones: FRAMES.spec.tones },
    { session: SPEC_SESSION, from: start.used, since: 0.3 },
  );
}
