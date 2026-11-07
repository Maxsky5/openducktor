// The tabs of the right panel of a task session, from panel-tab-kinds.ts: Document, Diffs, Files,
// and CI Checks, which shows only with a linked pull request. A dot on the CI Checks icon shows
// the state of the checks.
import { FileDiff, FileText, FolderTree, ListChecks } from "lucide-react";
import type { ReactElement } from "react";
import type { StudioFrame } from "./model";
import { PanelStrip } from "./PanelStrip";
import { PanelTab } from "./PanelTab";
import "./PanelTabs.css";

export function PanelTabs({ frame }: { frame: StudioFrame }): ReactElement {
  return (
    <PanelStrip panel="right">
      <PanelTab id="document" label="Document" active={frame.panel === "document"}>
        <FileText />
      </PanelTab>
      <PanelTab id="diffs" label="Diffs" active={frame.panel === "diffs"}>
        <FileDiff />
      </PanelTab>
      <PanelTab id="files" label="Files">
        <FolderTree />
      </PanelTab>
      <PanelTab
        id="ci_checks"
        label="CI Checks"
        active={frame.panel === "ci_checks"}
        hidden={!frame.checksTab}
      >
        <ListChecks />
        <i className="ci-dot" data-checks="passing" data-ci="" />
      </PanelTab>
    </PanelStrip>
  );
}
