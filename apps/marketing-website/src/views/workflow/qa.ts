import type { Scene } from "../../motion/scene";
import { studioWindow } from "../../replica/studio/studio";
import {
  BUILD_FILES,
  BUILDER_FIX_SESSION,
  BUILDER_SESSION,
  DOCUMENTS,
  FIXED_FILES,
  fileOf,
  FRAMES,
  HOOK_PATH,
  QA_SESSION,
  TEST_PATH,
} from "../../sample/studio";
import type { RowId } from "../../sample/transcripts";
import { endTurn, saveDocument, showPanel, startSession } from "./session";

/** The templates of QaStep.astro. */
export type QaTemplate = "qa-dialog" | "fix-dialog";

/**
 * QA: you request the QA review where Build ends. The QA agent rejects the change and saves its
 * report. The Builder reuses its session to fix the finding.
 */
export function qa(scene: Scene<QaTemplate>): void {
  const studio = studioWindow(scene);
  const row = (id: RowId<"qa">): HTMLElement => studio.row("qa", id);
  const fix = (id: RowId<"fix">): HTMLElement => studio.row("fix", id);
  studio.hideTurns("qa", "fix");
  studio.setSessionShown("build");
  studio.apply(FRAMES.build);
  studio.panels.setDocument(DOCUMENTS.qa, false);
  for (const file of BUILD_FILES) studio.panels.setFile(file);
  studio.panels.setTotals(BUILD_FILES);
  studio.panels.setAhead(1);

  // You request the QA review. A fresh QA session starts.
  const reviewing = startSession(
    studio,
    0.6,
    "qa-dialog",
    {
      selected: "qa",
      tones: ["done", "done", "done", "in_progress"],
      session: QA_SESSION,
      documentTab: true,
      panel: "document",
    },
    "qa",
  );
  studio.rows.show(row("kickoff"), reviewing + 0.3);
  studio.rows.tool(row("read-task"), reviewing + 0.9, 0.3);
  studio.rows.tool(row("read-hook"), reviewing + 1.4, 0.25);
  studio.rows.tool(row("test"), reviewing + 1.9, 1);
  studio.rows.tool(row("search"), reviewing + 3.2, 0.4);
  const rejected = saveDocument(
    studio,
    row("rejected"),
    reviewing + 4,
    DOCUMENTS.qa.updated,
    { tones: ["done", "done", "done", "rejected"], action: "Address QA Feedbacks" },
    2.2,
  );
  const reported = endTurn(
    studio,
    row("final"),
    rejected + 2.4,
    {},
    { session: QA_SESSION, from: 2.9, since: reviewing },
  );

  // You send the report back to the Builder, which reuses its session.
  const started = startSession(
    studio,
    reported + 0.6,
    "fix-dialog",
    {
      selected: "build",
      tones: ["done", "done", "in_progress", "rejected"],
      session: BUILDER_SESSION,
      documentTab: false,
      panel: "git",
    },
    "build",
  );
  studio.rows.show(fix("kickoff"), started + 0.3);
  studio.rows.tool(fix("read-task"), started + 0.9, 0.3);
  const hookAt = started + 1.5;
  const testAt = hookAt + 0.8;
  const hookFixed = BUILD_FILES.map((file) =>
    file.path === HOOK_PATH ? fileOf(FIXED_FILES, HOOK_PATH) : file,
  );
  studio.rows.show(fix("hook"), hookAt);
  studio.panels.fileLines(HOOK_PATH, fileOf(FIXED_FILES, HOOK_PATH).add, hookAt + 0.2);
  studio.panels.totals(hookFixed, hookAt + 0.2);
  studio.rows.show(fix("test"), testAt);
  studio.panels.fileLines(TEST_PATH, fileOf(FIXED_FILES, TEST_PATH).add, testAt + 0.2);
  studio.panels.totals(FIXED_FILES, testAt + 0.2);
  showPanel(studio, hookAt + 0.1, testAt + 1.1 - hookAt);

  const ran = studio.rows.tool(fix("run"), testAt + 1.3, 1);
  const committed = studio.rows.tool(fix("commit"), ran + 0.3, 0.3);
  studio.panels.ahead(2, committed);
  const completed = studio.rows.workflow(fix("completed"), committed + 0.4, 0.5);
  studio.patch(completed, { action: "Request QA Review" });
  endTurn(
    studio,
    fix("final"),
    completed + 0.4,
    { tones: FRAMES.qa.tones },
    { session: BUILDER_FIX_SESSION, from: BUILDER_SESSION.used, since: started },
  );
}
