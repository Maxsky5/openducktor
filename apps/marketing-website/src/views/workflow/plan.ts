import type { Scene } from "../../motion/scene";
import { studioWindow } from "../../replica/studio/studio";
import { DOCUMENTS, FRAMES, PLANNER_SESSION } from "../../sample/studio";
import type { RowId } from "../../sample/transcripts";
import { endTurn, saveDocument, startSession } from "./session";

/** The templates of PlanStep.astro. */
export type PlanTemplate = "spec-document" | "planner-dialog";

/**
 * Plan: the step starts on the Spec session, where Spec ends. You start the Planner. It reads the
 * spec and the code, and saves the plan.
 */
export function plan(scene: Scene<PlanTemplate>): void {
  const studio = studioWindow(scene);
  const row = (id: RowId<"plan">): HTMLElement => studio.row("plan", id);
  studio.hideTurns("plan");
  studio.setSessionShown("spec");
  const planDocument = studio.panels.takeDocument();
  studio.panels.putDocument(scene.template("spec-document"));
  studio.panels.setDocument(DOCUMENTS.spec, true);
  studio.apply(FRAMES.spec);

  const started = startSession(
    studio,
    0.6,
    "planner-dialog",
    {
      selected: "planner",
      tones: ["done", "in_progress", "blocked", "blocked"],
      session: PLANNER_SESSION,
    },
    "planner",
  );
  scene.at(started, () => {
    studio.panels.setDocument(DOCUMENTS.plan, false);
    studio.panels.putDocument(planDocument);
  });

  studio.rows.show(row("kickoff"), started + 0.3);
  studio.rows.tool(row("read-task"), started + 0.9, 0.3);
  studio.rows.tool(row("search"), started + 1.4, 0.4);
  studio.rows.tool(row("read-shell"), started + 2, 0.25);
  studio.rows.tool(row("read-keymap"), started + 2.45, 0.25);
  studio.rows.tool(row("read-dialog"), started + 2.9, 0.25);

  const saved = saveDocument(
    studio,
    row("set-plan"),
    started + 3.6,
    DOCUMENTS.plan.updated,
    { tones: ["done", "in_progress", "available", "blocked"], action: "Start Implementation" },
    2.5,
  );
  endTurn(
    studio,
    row("final"),
    saved + 2.7,
    { tones: FRAMES.plan.tones },
    { session: PLANNER_SESSION, from: 2.4, since: started },
  );
}
