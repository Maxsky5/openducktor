// The header of the workflow editor, from editor-header.tsx and version-switcher.tsx in
// packages/frontend/src/features/workflows/editor: the way back, the workflow name, the version
// menu button with the status of workflow-status-text.ts, the save status, Undo, Redo, the menu of
// more commands, and Publish while the workflow has a draft. A scene sets `data-tone` on the
// version button, `data-saving` on the save status, `data-disabled` on Undo, and `hidden` on
// Publish.
import {
  Check,
  ChevronDown,
  ChevronRight,
  Ellipsis,
  Loader2,
  Redo2,
  Undo2,
  Upload,
} from "lucide-react";
import type { ReactElement } from "react";
import { flag } from "../flag";
import { Button } from "../ui/Button";
import { HEADER_TEXT, versionLabel } from "./text";
import "./EditorHeader.css";

type EditorHeaderProps = {
  workflow: string;
  version: number;
  /** The workflow has unpublished changes: the status says so, and Publish shows. */
  draft: boolean;
  /** The editor has an edit to undo. */
  canUndo: boolean;
};

export function EditorHeader({
  workflow,
  version,
  draft,
  canUndo,
}: EditorHeaderProps): ReactElement {
  return (
    <div className="wfe-header">
      <div className="wfe-crumbs">
        <span className="wfe-crumb">{HEADER_TEXT.crumb}</span>
        <ChevronRight className="i14" />
        <span className="wfe-name">{workflow}</span>
      </div>
      <span className="wfe-version" data-version="" data-tone={draft ? "draft" : "published"}>
        <span className="wfe-version-dot" />
        <span className="wfe-version-label" data-version-label="">
          {versionLabel(version, draft)}
        </span>
        <ChevronDown className="i14" />
      </span>
      <div className="wfe-commands">
        <span className="wfe-save" data-save="">
          <Loader2 className="i14 spin wfe-saving-icon" />
          <Check className="i14 wfe-saved-icon" />
          <span data-save-text="">{HEADER_TEXT.saved}</span>
        </span>
        <span className="wfe-icon-button" data-undo="" data-disabled={flag(!canUndo)}>
          <Undo2 />
        </span>
        <span className="wfe-icon-button" data-disabled="">
          <Redo2 />
        </span>
        <span className="wfe-icon-button wfe-more">
          <Ellipsis />
        </span>
        <span className="wfe-publish" data-publish="" hidden={!draft}>
          <Button size="sm">
            <Upload className="i14" />
            {HEADER_TEXT.publish}
          </Button>
        </span>
      </div>
    </div>
  );
}
