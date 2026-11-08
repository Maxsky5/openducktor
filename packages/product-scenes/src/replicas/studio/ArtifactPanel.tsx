// The Artifacts tab of task-artifacts.tsx with a workflow artifact open. The header has the back
// button, the artifact name, and the edit, copy, and expand buttons of artifact-controls.tsx. Only
// a document has the edit button. The footer gives the format, the save time, and the verdict of
// a review. The markup holds the saved artifact, and a scene shows the absent artifact with
// data-artifact="empty": the header keeps only the back button and the name, and no footer shows.
import { ArrowLeft, Copy, Expand, Pencil } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { Button } from "../ui/Button";
import type { ArtifactLabels } from "./model";
import "./ArtifactPanel.css";

type ArtifactPanelProps = {
  labels: ArtifactLabels;
  /** The saved artifact. */
  children?: ReactNode;
};

export function ArtifactPanel({ labels, children }: ArtifactPanelProps): ReactElement {
  return (
    <div className="st-artifact" data-panel="document" data-artifact="filled">
      <div className="st-artifact-head">
        <Button variant="ghost" size="icon" className="st-artifact-button">
          <ArrowLeft />
        </Button>
        <span className="st-artifact-title" data-artifact-title="">
          {labels.title}
        </span>
        <span className="st-artifact-tools">
          <Button
            variant="ghost"
            size="icon"
            className="st-artifact-button"
            hidden={!labels.editable}
            data-artifact-edit=""
          >
            <Pencil />
          </Button>
          <Button variant="ghost" size="icon" className="st-artifact-button">
            <Copy className="i14" />
          </Button>
          <Button variant="ghost" size="icon" className="st-artifact-button">
            <Expand />
          </Button>
        </span>
      </div>
      <p className="st-artifact-empty" data-artifact-empty="">
        {labels.empty}
      </p>
      <div className="st-artifact-content" data-artifact-content="">
        {children}
      </div>
      <div className="st-artifact-foot">
        <span>Markdown</span>
        <time>just now</time>
        <span className="st-artifact-verdict" hidden={!labels.verdict} data-artifact-verdict="">
          {labels.verdict}
        </span>
      </div>
    </div>
  );
}
