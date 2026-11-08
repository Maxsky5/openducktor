import { must } from "../../motion/dom";
import type { SceneBuilder } from "../../motion/scene";
import { composerActivity } from "../../replicas/shell/composer";
import { pointer } from "../../replicas/shell/cursor";
import { ciChecks } from "../../replicas/studio/ci-checks";
import { follow, transcript } from "../../replicas/transcript/rows";
import { FAILING, READS } from "./sample";

/**
 * The visitor follows the checks of a pull request in the CI Checks tab while the Builder waits
 * for them. The tab reads the checks only when you select Refresh CI checks, so each new state
 * shows after a refresh. The first refresh shows the failed test check, and the visitor opens it.
 * The Builder reads the failed log, fixes the cause, and pushes. The next refresh shows the new
 * run of the test check, and the last one shows every check passing. A phone stage shows only the
 * panel. The markup holds the last frame.
 */
export const build: SceneBuilder = (scene) => {
  const root = must(scene.stage, "[data-root]");
  const checks = ciChecks(scene, root);
  const rows = transcript(scene, root);
  const row = (id: string): HTMLElement => must(root, `[data-row="${id}"]`);
  const setActivity = composerActivity(root);
  const cursor = pointer(scene, root);
  follow(scene, must(root, "[data-track]"));

  // Start: the Builder opened the pull request and watches its checks. Lint and typecheck pass,
  // and test and build run.
  checks.set(READS.first.states, READS.first.updated);
  for (const id of ["log", "cause", "test", "push", "rewatch", "final"]) row(id).hidden = true;
  const watch = must(row("watch"), "[data-tool]");
  watch.toggleAttribute("data-running", true);
  setActivity("working");

  // The visitor refreshes the tab. The test check failed, and the build check passed. The watch
  // of the Builder ends with the failure.
  const refreshed = cursor.click(() => checks.button, 0.5);
  const failed = checks.refresh(refreshed, READS.failed.states, READS.failed.updated);
  scene.at(failed + 0.2, () => watch.removeAttribute("data-running"));

  // The visitor opens the failed check to read its details and its times.
  const opened = cursor.click(() => must(checks.row(FAILING), "[data-check-row]"), failed + 0.8);
  checks.open(FAILING, true, opened);
  cursor.hide(opened + 0.6);

  // The Builder reads the failed log, fixes the cause, runs the tests, and pushes the fix. Then
  // it watches the checks of the new commit.
  const logged = rows.tool(row("log"), opened + 0.3, 0.9);
  const said = rows.say(row("cause"), logged + 0.3);
  const tested = rows.tool(row("test"), said + 0.4, 1.1);
  const pushed = rows.tool(row("push"), tested + 0.3, 0.6);
  const rewatched = rows.start(row("rewatch"), pushed + 0.3);

  // A refresh shows the new run of the test check. The new run is a new row, so it is closed.
  const again = cursor.click(() => checks.button, pushed + 0.6);
  checks.open(FAILING, false, again + 0.6);
  const rerun = checks.refresh(again, READS.rerun.states, READS.rerun.updated);
  cursor.hide(rerun + 0.4);

  // Every check passes. The Builder ends its turn with the result.
  const ended = rerun + 2.2;
  rewatched(ended);
  const finished = rows.say(row("final"), ended + 0.3);
  scene.at(finished, () => setActivity("idle"));

  // The last refresh shows every check passing.
  const last = cursor.click(() => checks.button, finished + 0.3);
  const passed = checks.refresh(last, READS.passed.states, READS.passed.updated);
  cursor.hide(passed + 0.6);
  scene.endAt(passed + 3);
};
