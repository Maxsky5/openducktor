import { must } from "../../motion/dom";
import type { Scene } from "../../motion/scene";
import { studioWindow } from "../../replica/studio/studio";
import { BUILD_FILES, BUILDER_SESSION, FRAMES } from "../../sample/studio";
import type { RowId } from "../../sample/transcripts";
import { endTurn, showPanel, startSession } from "./session";

/** The templates of BuildStep.astro. */
export type BuildTemplate = "builder-dialog" | "approval";

/**
 * Build: the step starts on the Planner session, where Plan ends. The Builder writes the change
 * in the task worktree. The commit needs your approval, and the files land in the Git tab.
 */
export function build(scene: Scene<BuildTemplate>): void {
  const studio = studioWindow(scene);
  const row = (id: RowId<"build">): HTMLElement => studio.row("build", id);
  studio.hideTurns("build");
  studio.setSessionShown("planner");
  studio.apply(FRAMES.plan);
  studio.panels.clearFiles();
  studio.panels.setAhead(0);

  // The Builder role has no document, so the Document tab goes away.
  const started = startSession(
    studio,
    0.6,
    "builder-dialog",
    {
      selected: "build",
      tones: ["done", "done", "in_progress", "blocked"],
      session: BUILDER_SESSION,
      documentTab: false,
      panel: "git",
    },
    "build",
  );

  studio.rows.show(row("kickoff"), started + 0.3);
  studio.rows.tool(row("read-task"), started + 0.9, 0.3);
  studio.rows.tool(row("read-guide"), started + 1.4, 0.25);

  // Each edit lands in the Git tab, in path order.
  const writing = started + 2;
  BUILD_FILES.forEach((file, index) => {
    const at = writing + index * 0.7;
    studio.rows.show(row(`patch-${index}`), at);
    studio.panels.landFile(file.path, at + 0.2);
    studio.panels.totals(BUILD_FILES.slice(0, index + 1), at + 0.2);
  });
  const written = writing + BUILD_FILES.length * 0.7;
  showPanel(studio, writing + 0.9, written - writing - 0.6);
  const tested = studio.rows.tool(row("test"), written + 0.4, 1);

  // The runtime asks before the commit. You approve commands for this session.
  const asked = tested + 0.4;
  const committed = studio.rows.start(row("commit"), asked);
  const approval = studio.requests.dock("approval", asked + 0.2);
  studio.patch(asked + 0.2, {
    activity: "waiting",
    tones: ["done", "done", "waiting_input", "blocked"],
  });
  const approved = studio.cursor.click(
    () => must(approval, '[data-approve="session"]'),
    asked + 1.6,
    0.9,
  );
  const resumed = studio.requests.undock(approval, approved + 0.3);
  studio.patch(approved + 0.3, {
    activity: "working",
    tones: ["done", "done", "in_progress", "blocked"],
  });
  studio.cursor.hide(approved + 0.5);
  committed(resumed + 0.3);
  studio.panels.ahead(1, resumed + 0.3);

  const completed = studio.rows.workflow(row("completed"), resumed + 0.8, 0.5);
  studio.patch(completed, {
    tones: ["done", "done", "in_progress", "available"],
    action: "Request QA Review",
  });
  endTurn(
    studio,
    row("final"),
    completed + 0.4,
    { tones: FRAMES.build.tones },
    { session: BUILDER_SESSION, from: 3.9, since: started },
  );
}
