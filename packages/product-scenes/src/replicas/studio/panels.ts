// The right panel of a task session: the Artifacts, Diffs, and CI Checks tabs of panel-tab-kinds.ts,
// with ArtifactPanel.tsx, GitPanel.tsx, and ChecksPanel.tsx.
import { all, must } from "../../motion/dom";
import { designPixel, growIn, pop, riseIn } from "../../motion/effects";
import type { Scene } from "../../motion/scene";
import { countTo } from "../../motion/text";
import type { ArtifactLabels, GitFile, PanelId } from "./model";
import { filesLabel } from "../format";
import { selectTab } from "./side-panels";

export type Checks = "passing" | "pending";

/** The sum of the added and the removed lines of `files`. */
function lineTotals(files: readonly GitFile[]): { add: number; del: number } {
  return files.reduce((total, file) => ({ add: total.add + file.add, del: total.del + file.del }), {
    add: 0,
    del: 0,
  });
}

/** The controller of the right panel of the window `root`. */
export function studioPanels(scene: Scene, root: HTMLElement) {
  const body = must(root, "[data-panel-body]");
  const panel = (id: PanelId): HTMLElement => must(body, `[data-panel="${id}"]`);
  const strip = must(root, '[data-strip="right"]');
  const tab = (id: PanelId): HTMLElement => must(strip, `[data-ptab="${id}"]`);

  const setPanel = (id: PanelId): void => selectTab(strip, body, id);
  /** The CI Checks tab shows only when the task has a pull request. */
  const setTab = (id: PanelId, shown: boolean): void => {
    tab(id).hidden = !shown;
  };
  /** Shows or hides a tab at the playhead. A new tab pops. */
  const showTab = (id: PanelId, shown: boolean): void => {
    setTab(id, shown);
    if (shown) scene.run(pop(tab(id), 1.12));
  };

  // Artifacts tab.
  const view = (): HTMLElement => panel("document");
  const setArtifact = (labels: ArtifactLabels, filled: boolean): void => {
    const element = view();
    element.dataset.artifact = filled ? "filled" : "empty";
    must(element, "[data-artifact-title]").textContent = labels.title;
    must(element, "[data-artifact-empty]").textContent = labels.empty;
    must(element, "[data-artifact-edit]").hidden = !labels.editable;
    const verdict = must(element, "[data-artifact-verdict]");
    verdict.textContent = labels.verdict ?? "";
    verdict.hidden = !labels.verdict;
  };
  /** Moves the artifact content out of the panel. Returns it, so a later step can put it back. */
  const takeArtifact = (): HTMLElement => {
    const holder = document.createElement("div");
    holder.append(...must(view(), "[data-artifact-content]").childNodes);
    return holder;
  };
  const putArtifact = (holder: HTMLElement): void => {
    must(view(), "[data-artifact-content]").replaceChildren(...holder.childNodes);
  };
  /** The agent saves the artifact: the panel fills block by block. */
  const fill = (at: number): void =>
    scene.at(at, () => {
      const element = view();
      element.dataset.artifact = "filled";
      scene.run(
        riseIn(
          all(element, "[data-artifact-content] [data-prose] > *"),
          6 * designPixel(root),
          0.35,
          0.05,
        ),
      );
    });

  // Diffs tab.
  const git = (): HTMLElement => panel("diffs");
  const fileItem = (path: string): HTMLElement => must(git(), `[data-file="${path}"]`);
  /** Removed lines and commit counts hide at zero, as the product hides them. */
  const setCount = (element: HTMLElement, prefix: string, value: number): void => {
    element.textContent = `${prefix}${value}`;
    element.hidden = value === 0;
  };
  /** The push badge counts the same commits as the count ahead of the target. */
  const pushBadge = (): HTMLElement => must(git(), '[data-git-action="push"] [data-badge]');
  const setAhead = (commits: number): void => {
    const element = git();
    must(element, "[data-ahead]").textContent = `${commits}`;
    must(element, "[data-counts]").hidden =
      commits === 0 && must(element, "[data-behind]").textContent === "0";
    setCount(pushBadge(), "", commits);
  };
  const ahead = (commits: number, at: number): void =>
    scene.at(at, () => {
      setAhead(commits);
      for (const element of [must(git(), "[data-counts]"), pushBadge()])
        scene.run(pop(element, 1.35));
    });
  const setFile = (file: GitFile): void => {
    must(fileItem(file.path), "[data-add]").textContent = `+${file.add}`;
    setCount(must(fileItem(file.path), "[data-del]"), "-", file.del);
  };
  const setTotals = (files: readonly GitFile[]): void => {
    const { add, del } = lineTotals(files);
    must(git(), "[data-total-add]").textContent = `+${add}`;
    setCount(must(git(), "[data-total-del]"), "-", del);
  };
  /** Counts the added lines of a file from its current value. */
  const fileLines = (path: string, to: number, at: number): void =>
    countTo(scene, must(fileItem(path), "[data-add]"), to, at, { prefix: "+" });
  /** Counts the totals of the Diffs tab from their current values. */
  const totals = (files: readonly GitFile[], at: number): void => {
    const { add, del } = lineTotals(files);
    countTo(scene, must(git(), "[data-total-add]"), add, at, { prefix: "+" });
    const removed = must(git(), "[data-total-del]");
    scene.at(at, () => {
      if (removed.textContent === `-${del}`) return;
      setCount(removed, "-", del);
      scene.run(pop(removed));
    });
  };
  /** Build time: the Diffs tab shows the empty state until the first file lands. */
  const clearFiles = (): void => {
    const element = git();
    element.dataset.git = "empty";
    for (const item of all(element, "[data-file]")) item.hidden = true;
    must(element, "[data-file-count]").textContent = filesLabel(0);
    must(element, "[data-branch-count]").hidden = true;
    setTotals([]);
  };
  /** A file appears in the Diffs tab in path order. */
  const landFile = (path: string, at: number): void =>
    scene.at(at, () => {
      const element = git();
      const item = fileItem(path);
      element.dataset.git = "filled";
      item.hidden = false;
      scene.run(growIn(item, 0.35));
      const shown = all(element, "[data-file]:not([hidden])").length;
      must(element, "[data-file-count]").textContent = filesLabel(shown);
      const count = must(element, "[data-branch-count]");
      count.textContent = `${shown}`;
      count.hidden = false;
    });

  // CI Checks tab.
  /** Every check gets the same state. */
  const setChecks = (state: Checks, updated: string): void => {
    const element = panel("ci_checks");
    const rows = all(element, "[data-check]");
    element.dataset.checks = state;
    for (const row of rows) row.dataset.state = state === "passing" ? "success" : "pending";
    must(element, "[data-checks-summary]").textContent = `${rows.length} ${state}`;
    must(element, "[data-checks-updated]").textContent = updated;
    must(root, "[data-ci]").dataset.checks = state;
  };
  const checks = (state: Checks, updated: string, at: number): void =>
    scene.at(at, () => setChecks(state, updated));

  return {
    panel,
    setPanel,
    setTab,
    showTab,
    setArtifact,
    takeArtifact,
    putArtifact,
    fill,
    git,
    fileItem,
    setAhead,
    ahead,
    setFile,
    setTotals,
    fileLines,
    totals,
    clearFiles,
    landFile,
    setChecks,
    checks,
  };
}
