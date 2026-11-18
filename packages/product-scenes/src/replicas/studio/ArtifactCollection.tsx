// The Artifacts tab of task-artifacts.tsx with no artifact open: the header with Add artifact, then
// the collection in the default density of the panel. The Workflow group lists the workflow
// documents, and the Files group lists the files that an agent or a user saved. A group without an
// artifact does not show. A scene shows a hidden group when a save adds its first file. Each row
// has the icon of its media type, the name, the format, the size of a file, the time since the
// last save, and a chevron. The rows have the `data-artifact-id` of the product.
import { ChevronRight, FileCode2, FileImage, FileText, type LucideIcon, Plus } from "lucide-react";
import type { ReactElement } from "react";
import { artifactFormat, fileSize } from "../format";
import { Button } from "../ui/Button";
import type { ArtifactEntry, ArtifactGroups } from "./model";
import "./ArtifactPanel.css";
import "./ArtifactCollection.css";

/** The icon of a media type: ArtifactIcon of task-artifacts.tsx. */
function iconOf(mediaType: string): LucideIcon {
  const type = mediaType.toLowerCase();
  if (type.startsWith("image/")) return FileImage;
  if (["text/html", "application/json"].includes(type)) return FileCode2;
  return FileText;
}

/** The format, the size of a file, and the time since the last save: ArtifactMetadata. */
export function ArtifactMeta({ artifact }: { artifact: ArtifactEntry }): ReactElement {
  return (
    <span className="ar-meta">
      <span>{artifactFormat(artifact.mediaType)}</span>
      {artifact.bytes !== undefined && <span>{fileSize(artifact.bytes)}</span>}
      <time>{artifact.updated}</time>
    </span>
  );
}

function ArtifactRow({ artifact }: { artifact: ArtifactEntry }): ReactElement {
  const Icon = iconOf(artifact.mediaType);
  return (
    <li>
      <Button variant="ghost" className="ar-row" data-artifact-id={artifact.id}>
        <Icon className="ar-row-icon" />
        <span className="ar-row-text">
          <span className="ar-row-name">{artifact.name}</span>
          <ArtifactMeta artifact={artifact} />
        </span>
        <ChevronRight className="i14 ar-row-chevron" />
      </Button>
    </li>
  );
}

const GROUPS = [
  { id: "workflow", name: "Workflow" },
  { id: "files", name: "Files" },
] as const satisfies readonly { id: keyof ArtifactGroups; name: string }[];

type ArtifactCollectionProps = {
  groups: ArtifactGroups;
  /** An artifact is open, so the collection waits for the back button. */
  hidden?: boolean;
};

export function ArtifactCollection({
  groups,
  hidden = false,
}: ArtifactCollectionProps): ReactElement {
  return (
    <div className="ar-collection" data-artifact-view="collection" hidden={hidden}>
      <div className="st-artifact-head">
        <span className="st-artifact-title">Artifacts</span>
        <Button variant="ghost" size="sm">
          <Plus />
          Add artifact
        </Button>
      </div>
      <div className="ar-list">
        {GROUPS.map(({ id, name }) => (
          <div
            className="ar-group"
            data-artifact-group={id}
            hidden={groups[id].length === 0}
            key={id}
          >
            <span className="ar-group-name">{name}</span>
            <ul className="ar-rows">
              {groups[id].map((artifact) => (
                <ArtifactRow artifact={artifact} key={artifact.id} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
