// The dialog that Expand of a file opens: TaskArtifactPreviewDialog of
// task-artifact-preview-dialog.tsx. It takes the width of the window up to max-w-5xl and the height
// of the window less 4rem. The header shows the name, the close button sits in its corner, and the
// preview of the file fills the rest. The children hold the page of an HTML file.
import { X } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { HtmlPreview } from "./HtmlPreview";
import "./StartDialog.css";
import "./ArtifactPreviewDialog.css";

type ArtifactPreviewDialogProps = { name: string; children: ReactNode };

export function ArtifactPreviewDialog({
  name,
  children,
}: ArtifactPreviewDialogProps): ReactElement {
  return (
    <div className="st-overlay">
      <div className="st-dialog ar-dialog" data-dialog-box="">
        <div className="ar-dialog-head">
          <b>{name}</b>
        </div>
        <HtmlPreview>{children}</HtmlPreview>
        <span className="st-dialog-close" data-dialog-close="">
          <X />
        </span>
      </div>
    </div>
  );
}
