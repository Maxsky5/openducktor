// The Artifacts tab of task-artifacts.tsx with a file open: ArtifactContentView of a free artifact.
// The header has the back button, the name, and the controls of FreeArtifactControls in
// artifact-controls.tsx: Download, Expand, and Artifact actions. The preview of the file fills the
// tab, and the footer gives the file name, the format, the size, and the time since the save. The
// children hold the page of an HTML file.
import { ArrowLeft, Download, Ellipsis, Expand } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { Button } from "../ui/Button";
import { ArtifactMeta } from "./ArtifactCollection";
import { HtmlPreview } from "./HtmlPreview";
import type { ArtifactEntry } from "./model";
import "./ArtifactPanel.css";
import "./ArtifactFile.css";

type ArtifactFileProps = {
  artifact: ArtifactEntry;
  fileName: string;
  /** The collection shows, so the file waits for a click on its row. */
  hidden?: boolean;
  children: ReactNode;
};

export function ArtifactFile({
  artifact,
  fileName,
  hidden = false,
  children,
}: ArtifactFileProps): ReactElement {
  return (
    <div className="st-artifact ar-file" data-artifact-view="file" hidden={hidden}>
      <div className="st-artifact-head">
        <Button variant="ghost" size="icon" className="st-artifact-button">
          <ArrowLeft />
        </Button>
        <span className="st-artifact-title">{artifact.name}</span>
        <span className="st-artifact-tools">
          <Button variant="ghost" size="icon" className="st-artifact-button">
            <Download />
          </Button>
          <Button variant="ghost" size="icon" className="st-artifact-button" data-artifact-expand>
            <Expand />
          </Button>
          <Button variant="ghost" size="icon" className="st-artifact-button">
            <Ellipsis />
          </Button>
        </span>
      </div>
      <HtmlPreview>{children}</HtmlPreview>
      <div className="st-artifact-foot ar-file-foot">
        <span className="ar-file-name">{fileName}</span>
        <ArtifactMeta artifact={artifact} />
      </div>
    </div>
  );
}
