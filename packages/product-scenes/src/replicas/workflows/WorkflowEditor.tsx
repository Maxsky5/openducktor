// The workflow editor page: WorkflowEditor of workflow-editor.tsx in
// packages/frontend/src/features/workflows/editor, at a width of three panels. The header, the
// element list, the canvas with the readiness line under it, and the details of the selection,
// with the resize handles between them. The details show only while an element is selected: a
// scene shows them with `hidden` on `data-details` and its handle.
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { ResizeHandle } from "../ui/ResizeHandle";
import { Canvas } from "./Canvas";
import { EditorHeader } from "./EditorHeader";
import { OutlinePanel } from "./OutlinePanel";
import { ProblemsBar } from "./ProblemsBar";
import "./WorkflowEditor.css";

type WorkflowEditorProps = {
  header: ComponentProps<typeof EditorHeader>;
  outline: ComponentProps<typeof OutlinePanel>;
  canvas: ComponentProps<typeof Canvas>;
  problems: ComponentProps<typeof ProblemsBar>;
  /** The details of each element that the scene selects. */
  details: ReactNode;
  /** An element is selected, so its details show. */
  detailsOpen: boolean;
};

export function WorkflowEditor({
  header,
  outline,
  canvas,
  problems,
  details,
  detailsOpen,
}: WorkflowEditorProps): ReactElement {
  return (
    <div className="wfe">
      <EditorHeader {...header} />
      <div className="wfe-panels">
        <div className="wfe-outline-panel">
          <OutlinePanel {...outline} />
        </div>
        <ResizeHandle orientation="vertical" />
        <div className="wfe-center">
          <Canvas {...canvas} />
          <ProblemsBar {...problems} />
        </div>
        <ResizeHandle orientation="vertical" data-details-handle hidden={!detailsOpen} />
        <div className="wfe-details" data-details="" hidden={!detailsOpen}>
          {details}
        </div>
      </div>
    </div>
  );
}
