// The task panel of the Agent Studio: the Document, Git, and CI Checks tabs of
// task-execution-panel.tsx, with DocumentPanel.astro, GitPanel.astro, and ChecksPanel.astro.
import { all, data, must } from "../../motion/dom";
import { designPixel, growIn, pop, riseIn } from "../../motion/effects";
import type { Scene } from "../../motion/scene";
import { countTo } from "../../motion/text";
import type { DocumentLabels, GitFile, PanelId } from "../../sample/studio";
import { filesLabel } from "../format";

export type Checks = "passing" | "pending";

/** The sum of the added and the removed lines of `files`. */
function lineTotals(files: readonly GitFile[]): { add: number; del: number } {
  return files.reduce((total, file) => ({ add: total.add + file.add, del: total.del + file.del }), {
    add: 0,
    del: 0,
  });
}

/** The controller of the task panel of the window `root`. */
export function studioPanels(scene: Scene, root: HTMLElement) {
  const body = must(root, "[data-panel-body]");
  const panel = (id: PanelId): HTMLElement => must(body, `:scope > [data-panel="${id}"]`);
  const tabItem = (id: PanelId): HTMLElement => must(root, `[data-ptab-item="${id}"]`);

  const setPanel = (id: PanelId): void => {
    for (const tab of all(root, "[data-ptab]"))
      tab.toggleAttribute("data-active", data(tab, "ptab") === id);
    body.dataset.activePanel = id;
  };
  /** The Document and CI Checks tabs show only when the role or the task has them. */
  const setTab = (id: PanelId, shown: boolean): void => {
    tabItem(id).hidden = !shown;
  };
  /** Shows or hides a tab at the playhead. A new tab pops. */
  const showTab = (id: PanelId, shown: boolean): void => {
    setTab(id, shown);
    if (shown) scene.run(pop(must(tabItem(id), "[data-ptab]"), 1.12));
  };

  // Document tab.
  const view = (): HTMLElement => panel("document");
  const setDocument = (labels: DocumentLabels, filled: boolean): void => {
    const element = view();
    element.dataset.document = filled ? "filled" : "empty";
    must(element, "[data-doc-title]").textContent = labels.title;
    must(element, "[data-doc-description]").textContent = labels.description;
    must(element, "[data-doc-empty]").textContent = labels.empty;
    must(element, "[data-updated]").textContent = filled ? labels.updated : "Not set";
  };
  /** Moves the document content out of the panel. Returns it, so a later step can put it back. */
  const takeDocument = (): HTMLElement => {
    const holder = document.createElement("div");
    holder.append(...must(view(), "[data-doc]").childNodes);
    return holder;
  };
  const putDocument = (holder: HTMLElement): void => {
    must(view(), "[data-doc]").replaceChildren(...holder.childNodes);
  };
  /** The agent saves the document: the panel fills block by block. */
  const fill = (updated: string, at: number): void =>
    scene.at(at, () => {
      const element = view();
      element.dataset.document = "filled";
      must(element, "[data-updated]").textContent = updated;
      scene.run(
        riseIn(all(element, "[data-doc] [data-prose] > *"), 6 * designPixel(root), 0.35, 0.05),
      );
    });

  // Git tab.
  const git = (): HTMLElement => panel("git");
  const fileItem = (path: string): HTMLElement => must(git(), `[data-file="${path}"]`);
  /** Removed lines and commit counts hide at zero, as the product hides them. */
  const setCount = (element: HTMLElement, prefix: string, value: number): void => {
    element.textContent = `${prefix}${value}`;
    element.hidden = value === 0;
  };
  const setAhead = (commits: number): void => {
    for (const element of all(git(), "[data-ahead], [data-push]")) setCount(element, "", commits);
  };
  const ahead = (commits: number, at: number): void =>
    scene.at(at, () => {
      setAhead(commits);
      for (const element of all(git(), "[data-ahead], [data-push]")) scene.run(pop(element, 1.35));
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
  /** Counts the totals of the Git tab from their current values. */
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
  /** Build time: the Git tab shows the empty state until the first file lands. */
  const clearFiles = (): void => {
    const element = git();
    element.dataset.git = "empty";
    for (const item of all(element, "[data-file]")) item.hidden = true;
    must(element, "[data-file-count]").textContent = filesLabel(0);
    setTotals([]);
  };
  /** A file appears in the Git tab in path order. */
  const landFile = (path: string, at: number): void =>
    scene.at(at, () => {
      const element = git();
      const item = fileItem(path);
      element.dataset.git = "filled";
      item.hidden = false;
      scene.run(growIn(item, 0.35));
      const shown = all(element, "[data-file]:not([hidden])").length;
      must(element, "[data-file-count]").textContent = filesLabel(shown);
    });

  // CI Checks tab.
  const setChecks = (state: Checks, updated: string): void => {
    const element = panel("ci_checks");
    element.dataset.checks = state;
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
    setDocument,
    takeDocument,
    putDocument,
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
