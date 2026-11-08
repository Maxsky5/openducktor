// The tabs of the right panel of a task session, from panel-tab-kinds.ts: Artifacts, Diffs, Files,
// and CI Checks, which shows only with a linked pull request. A dot on the CI Checks icon shows
// the state of the checks, and a count shows the open review threads. The children hold more tabs,
// such as a terminal or a browser tab, and `start` holds the controls before the tabs.
import { FileDiff, FileText, FolderTree, ListChecks } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import type { PanelId } from "./model";
import { PanelStrip } from "./PanelStrip";
import { PanelTab } from "./PanelTab";
import "./PanelTabs.css";

type PanelTabsProps = {
  /** The active tool tab. A tab in the children sets its own state. */
  active?: PanelId;
  /**
   * The CI Checks tab of a linked pull request. A hidden tab waits for a scene to show it. The
   * thread count shows the open review threads on its icon.
   */
  checks?: { hidden?: boolean; threads?: number };
  /** Tabs are out of view at the start of the strip. */
  fadeStart?: boolean;
  /** The strip shows its end when its tabs overflow, as when it scrolls to a tab at its end. */
  showEnd?: boolean;
  /** The controls before the tabs, such as Back to workspace. */
  start?: ReactNode;
  children?: ReactNode;
};

export function PanelTabs({
  active,
  checks,
  fadeStart = false,
  showEnd = false,
  start,
  children,
}: PanelTabsProps): ReactElement {
  return (
    <PanelStrip panel="right" fadeStart={fadeStart} showEnd={showEnd}>
      {start}
      <PanelTab id="document" label="Artifacts" active={active === "document"}>
        <FileText />
      </PanelTab>
      <PanelTab id="diffs" label="Diffs" active={active === "diffs"}>
        <FileDiff />
      </PanelTab>
      <PanelTab id="files" label="Files">
        <FolderTree />
      </PanelTab>
      {checks && (
        <PanelTab
          id="ci_checks"
          label="CI Checks"
          active={active === "ci_checks"}
          hidden={checks.hidden ?? false}
        >
          <ListChecks />
          {checks.threads !== undefined && <i className="ci-threads">{checks.threads}</i>}
          <i className="ci-dot" data-checks="passing" data-ci="" />
        </PanelTab>
      )}
      {children}
    </PanelStrip>
  );
}
