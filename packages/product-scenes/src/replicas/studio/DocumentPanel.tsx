// The Document tab of task-execution-document-panel.tsx: the document menu, the save date, and
// the full screen button over the document. The markup holds the saved document, and a scene
// shows the empty state with data-document="empty". An empty document has no copy button.
import { ChevronDown, Copy, Expand } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { Button } from "../ui/Button";
import type { DocumentLabels } from "./model";
import "./DocumentPanel.css";

type DocumentPanelProps = {
  labels: DocumentLabels;
  /** The saved document. */
  children?: ReactNode;
};

export function DocumentPanel({ labels, children }: DocumentPanelProps): ReactElement {
  return (
    <div className="st-document" data-panel="document" data-document="filled">
      <div className="st-doc-head">
        <span className="st-doc-title">
          <span data-doc-title="">{labels.title}</span>
          <ChevronDown />
        </span>
        <span className="st-doc-meta">
          <time data-updated="">{labels.updated}</time>
          <span className="st-doc-expand">
            <Expand className="i14" />
          </span>
        </span>
      </div>
      <div className="st-doc-body">
        <p className="st-doc-empty" data-doc-empty="">
          {labels.empty}
        </p>
        <Button variant="outline" size="icon" className="st-doc-button st-doc-copy">
          <Copy className="i14" />
        </Button>
        <div className="st-doc-scroll" data-doc="">
          {children}
        </div>
      </div>
    </div>
  );
}
