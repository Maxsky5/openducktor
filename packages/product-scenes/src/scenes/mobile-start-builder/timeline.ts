import { must } from "../../motion/dom";
import type { SceneBuilder } from "../../motion/scene";
import { boardPager } from "../../replicas/mobile/board-pager";
import { finger } from "../../replicas/mobile/finger";
import { screens } from "../../replicas/mobile/screens";
import { startProgress } from "../../replicas/mobile/start-progress";
import { stepList } from "../../replicas/mobile/steps";
import { toolRuns } from "../../replicas/mobile/tool-runs";
import { topButton } from "../../replicas/mobile/top-button";
import { transcript } from "../../replicas/transcript/rows";
import { FIRST_LANE, READY_LANE } from "./sample";

/** The reply that the Builder adds after the start. The tool runs show their calls as they come. */
const LATER_ROWS = ["plan"];

/**
 * Seconds of each part of the start: until the first snapshot of the host, which has the steps of
 * the new task worktree, then the steps of the host.
 */
const START = { snapshot: 0.3, worktree: 0.7, upstream: 0.3, session: 0.9 };

/**
 * The visitor starts the Builder from the board. The Tasks tab shows Backlog. Two swipes move the
 * board to Ready for Dev, and the pill, the lane title, and the board wash follow. A tap on Start
 * Builder opens the start sheet. Start session shows the progress on the button, and the startup
 * progress takes the place of the form while the host creates the task worktree, sets its
 * upstream, and starts the session. When the session is ready, the sheet fades out, and the app
 * pushes the new session over the board, where the Builder reads, searches, and answers. The
 * markup holds the open start sheet over the board on Ready for Dev.
 */
export const build: SceneBuilder = (scene) => {
  const root = must(scene.stage, "[data-root]");
  const steps = stepList(scene, root);
  const phone = screens(scene, root);
  const tap = finger(scene, root).tap;
  const pager = boardPager(scene, root);
  const session = phone.screen("session");
  const sheet = phone.screen("start");
  const progress = startProgress(scene, sheet);
  const rows = transcript(scene, session);
  const runs = toolRuns(scene, session);
  const row = (id: string): HTMLElement => must(session, `[data-row="${id}"]`);
  topButton(scene, session);

  // Start: the board shows Backlog, and the session does not exist yet.
  phone.only("tasks");
  pager.select(FIRST_LANE);
  for (const id of LATER_ROWS) row(id).hidden = true;
  runs.later("guide", "shell", "search", "list");

  // Two swipes move the board through Spec Ready to Ready for Dev.
  steps.show(1, 1.2);
  scene.mark("swipe", 2.4);
  const first = pager.swipe(FIRST_LANE, FIRST_LANE + 1, 2.4);
  const ready = pager.swipe(FIRST_LANE + 1, READY_LANE, first + 1);
  scene.mark("ready", ready);

  // The card of the search shortcut task offers Start Builder, and a tap opens the start sheet.
  steps.show(2, ready + 0.5);
  const tapped = tap(
    () => must(root, '[data-task-card="shortcut"] [data-card-start]'),
    ready + 1.8,
  );
  scene.mark("tap", tapped);
  const opened = phone.present("start", tapped);
  scene.mark("sheet", opened);

  // The visitor checks the choices and starts the session. The button shows the progress, the
  // start disables the other controls of the sheet, and Run in background becomes Continue in
  // background. The first snapshot of the host has the steps of the new task worktree, so the
  // startup progress takes the place of the form. Each step that ends starts the next one.
  steps.show(3, opened + 0.3);
  const button = must(sheet, "[data-start-session]");
  const started = tap(() => button, opened + 3.2);
  scene.mark("start", started);
  phone.busy("start", button, started);
  const traced = started + START.snapshot;
  progress.show(traced, { checkout: "running", upstream: "pending", session: "pending" });
  const checkedOut = traced + START.worktree;
  progress.set("checkout", "completed", checkedOut);
  progress.set("upstream", "running", checkedOut);
  const tracked = checkedOut + START.upstream;
  progress.set("upstream", "completed", tracked);
  progress.set("session", "running", tracked);

  // The session is ready. The sheet fades out, and the app pushes the session over the board.
  const shown = tracked + START.session;
  progress.set("session", "completed", shown);
  progress.ready(shown);
  scene.mark("session", shown);
  const closed = phone.dismiss("start", shown);
  phone.push("tasks", "session", shown);

  // The Builder reads the guide and the app shell and searches the code in one tool run. The run
  // folds when the answer comes after it.
  steps.show(4, closed);
  const guide = runs.call("guide", closed + 0.4, 0.5);
  const shell = runs.call("shell", guide + 0.3, 0.5);
  const search = runs.call("search", shell + 0.3, 0.7);
  const said = rows.say(row("plan"), search + 0.4);
  scene.mark("working", said);
  runs.fold("reading", search + 0.4);
  runs.start("list", said + 0.4);
  scene.endAt(said + 3.4);
};
