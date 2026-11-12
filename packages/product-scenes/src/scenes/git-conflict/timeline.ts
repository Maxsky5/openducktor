import { must } from "../../motion/dom";
import { growIn, pop, shrinkOut } from "../../motion/effects";
import type { SceneBuilder } from "../../motion/scene";
import { composerActivity } from "../../replicas/shell/composer";
import { pointer } from "../../replicas/shell/cursor";
import type { GitCounts } from "../../replicas/studio/GitHeader";
import { modal } from "../../replicas/studio/modal";
import { startDialog } from "../../replicas/studio/start-dialog";
import { follow, transcript } from "../../replicas/transcript/rows";
import { tooltip } from "../../replicas/ui/tip";
import { COUNTS, type GitConflictTemplate, REBASE_TIP } from "./sample";

/**
 * The visitor rebases the task branch onto its target, and the rebase stops on a conflict. The
 * conflict dialog opens, and a strip in the Diffs tab shows the paused rebase. The visitor selects
 * Resolve conflicts and starts the Builder session again with the conflict as its message. The
 * Builder resolves the file, runs the tests, and continues the rebase. Then the strip goes away,
 * and the branch is no longer behind its target. A phone stage shows only the panel. The markup
 * holds the last frame.
 */
export const build: SceneBuilder<GitConflictTemplate> = (scene) => {
  const root = must(scene.stage, "[data-root]");
  const git = must(root, '[data-panel="diffs"]');
  const header = must(git, ".gh");
  const rebase = must(git, '[data-git-action="rebase"]');
  const rebaseCount = must(rebase, "[data-badge]");
  const counts = must(git, "[data-counts]");
  const strip = scene.template("strip");
  const start = scene.template("start-dialog");
  const rows = transcript(scene, root);
  /** A row of the conflict turn. Its id differs from the rows of the build turn. */
  const step = (id: string): HTMLElement => must(root, `[data-row="conflict-${id}"]`);
  const setActivity = composerActivity(root);
  const tip = tooltip(root);
  const cursor = pointer(scene, root);
  const conflict = modal(scene, root, scene.template("conflict-dialog"), { attach: true });
  follow(scene, must(root, "[data-track]"));

  /** Shows the commits of the task branch against its target. */
  const setCounts = ({ ahead, behind }: GitCounts): void => {
    must(counts, "[data-ahead]").textContent = `${ahead}`;
    must(counts, "[data-behind]").textContent = `${behind}`;
    rebaseCount.textContent = `${behind}`;
    rebaseCount.hidden = behind === 0;
  };

  // Start: the Builder finished, and the target branch has new commits.
  setCounts(COUNTS.before);
  for (const id of ["message", "status", "read", "test", "rebase", "final"]) step(id).hidden = true;
  setActivity("idle");

  // The visitor selects Rebase onto target. Its tooltip shows the target and the commits behind.
  const pointed = cursor.point(() => rebase, 0.4);
  scene.at(pointed + 0.1, () => tip.show(rebase, REBASE_TIP));
  const rebased = cursor.click(() => rebase, pointed + 0.9, 0.05);
  scene.at(rebased, () => tip.hide());

  // The rebase stops on a conflict. The strip shows under the header, and the dialog opens.
  const stopped = rebased + 0.5;
  scene.at(stopped, () => {
    header.after(strip);
    scene.run(growIn(strip, 0.35));
  });
  conflict.open(stopped);

  // The visitor selects Resolve conflicts. The dialog closes, and the session start dialog opens
  // on the Builder session of the task.
  const resolved = cursor.click(() => must(conflict.box, "[data-resolve]"), stopped + 1.1, 0.8);
  conflict.close(resolved + 0.2);
  const started = startDialog(scene, root, cursor, start, resolved + 0.5);
  cursor.hide(started);

  // The Builder gets the conflict, resolves the file, runs the tests, and continues the rebase.
  rows.show(step("message"), started);
  scene.at(started, () => setActivity("working"));
  const checked = rows.tool(step("status"), started + 0.6, 0.3);
  const read = rows.tool(step("read"), checked + 0.3, 0.3);
  const tested = rows.tool(step("test"), read + 0.5, 1.2);
  const continued = rows.tool(step("rebase"), tested + 0.3, 0.5);

  // The rebase is complete. The strip goes away, and the branch is no longer behind its target.
  scene.at(continued, () => {
    scene.run(shrinkOut(strip, 0.35));
    setCounts(COUNTS.after);
    scene.run(pop(counts, 1.2));
  });
  const finished = rows.say(step("final"), continued + 0.4);
  scene.at(finished, () => setActivity("idle"));
  scene.endAt(finished + 3);
};
