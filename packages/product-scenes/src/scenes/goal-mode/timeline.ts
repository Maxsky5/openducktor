import type { SceneBuilder } from "../../motion/scene";
import { goalDialog } from "../../replicas/studio/goal-dialog";
import { goalRow } from "../../replicas/studio/goal-row";
import { studioWindow } from "../../replicas/studio/studio";
import { FRAMES, HOOK_PATH, TEST_PATH } from "../../sample/studio";
import { STORY_SESSIONS } from "../../sample/studio-nav";
import {
  GENERATED_GOAL,
  GOAL_FILES,
  GOAL_SESSION,
  type GoalModeTemplate,
  type GoalRowId,
  TURN_USE,
  type TurnId,
} from "./sample";

/** The files of the change by path, in the order that the Builder writes them. */
const SHELL_PATH = "src/app/app-shell.tsx";

/** Seconds from the click on Start session to the first startup snapshot of the host. */
const STARTING = 0.5;

/**
 * Goal mode: the visitor starts the Builder from the Planner session of a task in Ready for dev.
 * In the start dialog, Goal mode replaces the first message with a goal, and Generate goal writes a
 * sharper one. Start session disables the form, the startup progress shows in the dialog, then the
 * dialog goes and the Builder session opens. The goal row rises out of the composer, and Codex
 * starts each next goal turn by itself. When the Builder reports the build as completed and the
 * goal is met, the row shows Complete. The markup holds the last frame.
 */
export const build: SceneBuilder<GoalModeTemplate> = (scene) => {
  const studio = studioWindow(scene);
  const goal = goalRow(scene, studio.root);
  const row = <Turn extends TurnId>(turn: Turn, id: GoalRowId<Turn>): HTMLElement =>
    studio.row(turn, id);
  const builder = STORY_SESSIONS.build.id;

  // Start: the Planner session of the task in Ready for dev, with its plan in the Artifacts tab.
  studio.setSessionShown("planner");
  studio.apply(FRAMES.plan);
  studio.panels.clearFiles();
  studio.panels.setAhead(0);
  goal.reset("active");

  // Start Implementation opens the start dialog. Goal mode is off.
  const clicked = studio.quickAction(0.3);
  const dialog = goalDialog(scene, studio.root, studio.cursor, scene.template("builder-dialog"));
  dialog.open(clicked + 0.2);
  scene.mark("dialog", clicked + 0.2);

  // Goal mode on: the default goal shows, and Customize first message closes.
  const on = dialog.turnOn(clicked + 0.9);
  scene.mark("goal-on", on);

  // Generate goal: a model writes a goal from the task, its spec and plan, and the default goal.
  // The start waits for the goal.
  const generated = on + 4;
  dialog.generateGoal(on + 2, generated, GENERATED_GOAL);
  scene.mark("generate", on + 2);
  scene.mark("generated", generated);

  // Start session: the form is disabled while the start runs, then the dialog shows the startup
  // steps of the new task worktree.
  const started = dialog.start(generated + 1.6, STARTING);
  scene.mark("start", started);
  studio.cursor.hide(started + 0.3);
  const traced = started + STARTING;
  dialog.step("checkout", "running", traced + 0.2);
  dialog.step("checkout", "completed", traced + 0.7);
  dialog.step("upstream", "running", traced + 0.7);
  dialog.step("upstream", "completed", traced + 1.0);
  dialog.step("session", "running", traced + 1.0);
  dialog.step("session", "completed", traced + 1.6);
  const opened = traced + 1.8;
  dialog.unmount(opened);

  // The Builder session opens on the Diffs tab. It has no token use yet, so the composer shows no
  // context meter. The goal row rises, and the Builder works with no first message.
  studio.switchSession("goal", opened);
  studio.clearContext(opened);
  studio.patch(opened, {
    activity: "working",
    selected: "build",
    tones: ["done", "done", "in_progress", "blocked"],
    session: GOAL_SESSION,
    panel: "diffs",
  });
  studio.sessions.hide(STORY_SESSIONS.planner.id, opened);
  studio.sessions.update(builder, opened, {
    status: "in_progress",
    tone: "in_progress",
    running: true,
    selected: true,
  });
  goal.show(opened + 0.35);
  scene.mark("session", opened);

  /** An edit call joins its run, and its file lands in the Diffs tab. */
  const land = (edit: HTMLElement, path: string, files: number, at: number): number => {
    studio.rows.show(edit, at);
    studio.panels.landFile(path, at + 0.2);
    studio.panels.totals(GOAL_FILES.slice(0, files), at + 0.2);
    return at + 0.4;
  };

  // Turn 1: the Builder reads the task and the guide, and writes the hook and the app shell.
  let at = studio.rows.tool(row("write", "read-task"), opened + 0.8, 0.3);
  at = studio.rows.tool(row("write", "read-guide"), at + 0.25, 0.2);
  at = land(row("write", "hook"), HOOK_PATH, 1, at + 0.25);
  at = land(row("write", "shell"), SHELL_PATH, 2, at);
  const wrote = studio.rows.say(row("write", "final"), at + 0.2);
  studio.context({ ...GOAL_SESSION, used: TURN_USE[0] }, 0, opened + 0.8, wrote);

  // Turn 2: Codex starts the next goal turn by itself. The Builder writes and runs the tests.
  at = land(row("test", "test"), TEST_PATH, 3, wrote + 0.5);
  scene.mark("turn-2", wrote + 0.5);
  const tested = studio.rows.tool(row("test", "run"), at + 0.2, 1.2);
  const ran = studio.rows.say(row("test", "final"), tested + 0.3);
  studio.context({ ...GOAL_SESSION, used: TURN_USE[1] }, TURN_USE[0], wrote, ran);

  // Turn 3: the checks pass, and the Builder commits the change and reports the build as completed.
  scene.mark("turn-3", ran + 0.5);
  at = studio.rows.tool(row("submit", "checks"), ran + 0.5, 1);
  const committed = studio.rows.tool(row("submit", "commit"), at + 0.25, 0.3);
  studio.panels.ahead(1, committed);
  const completed = studio.rows.workflow(row("submit", "completed"), committed + 0.3, 0.45);
  studio.patch(completed, {
    tones: ["done", "done", "in_progress", "available"],
    action: "Request QA Review",
  });
  studio.sessions.update(builder, completed, { status: "ai_review" });
  const ended = studio.rows.say(row("submit", "final"), completed + 0.3);
  studio.context(GOAL_SESSION, TURN_USE[1], ran, ended);

  // The goal is met: the row shows Complete, and the session stops.
  goal.status(ended + 0.2, "complete");
  scene.mark("complete", ended + 0.2);
  studio.patch(ended + 0.2, { activity: "idle", tones: FRAMES.build.tones });
  studio.sessions.update(builder, ended + 0.2, { tone: "done", running: false, time: "now" });
  scene.endAt(ended + 3);
};
