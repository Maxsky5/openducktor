// The Configuration section of a repository in Settings: the Workspace identity card of
// settings-repository-configuration-section.tsx, with WorkspaceIdentityFields of
// workspace-identity-fields.tsx and WorkspaceTileColorPicker of workspace-tile-color-picker.tsx in
// packages/frontend/src/components/features. The workspace has no abbreviation of its own and the
// default tile color, so the Default swatch is selected and the picker shows no shades.
import { FolderOpen, Slash } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import "./RepositoryConfiguration.css";

/** The words of the card, the fields, and the picker. */
export const IDENTITY_TEXT = {
  title: "Workspace identity",
  description: "The workspace ID stays the same. You can change its name and repository folder.",
  workspaceId: "Workspace ID",
  workspaceName: "Workspace name",
  abbreviation: "Abbreviation",
  abbreviationHint: "Up to 3 characters.",
  tileColor: "Tile color",
  hexCode: "Hex code",
  repositoryPath: "Repository path",
  changeFolder: "Change folder",
  repositoryPathHint: "Use a different Git repository folder if this workspace has moved on disk.",
} as const;

/** The swatches of WORKSPACE_TILE_PALETTE in workspace-tile-appearance.ts, in their order. */
export const TILE_PALETTE = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#22c55e",
  "#10b981",
  "#14b8a6",
  "#0ea5e9",
  "#3b82f6",
  "#7c3aed",
  "#d946ef",
  "#f43f5e",
  "#64748b",
  "#ffffff",
  "#000000",
] as const;

type RepositoryConfigurationProps = {
  workspaceId: string;
  workspaceName: string;
  /** The initials that the abbreviation field shows as its placeholder. */
  initials: string;
  repositoryPath: string;
};

/** A field of the card: grid gap-2 with the label over the control, and an optional hint. */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="repo-cfg-field">
      <b>{label}</b>
      {children}
      {hint && <p className="repo-cfg-hint">{hint}</p>}
    </div>
  );
}

export function RepositoryConfiguration({
  workspaceId,
  workspaceName,
  initials,
  repositoryPath,
}: RepositoryConfigurationProps): ReactElement {
  return (
    <div className="repo-cfg-section">
      <div className="repo-cfg-card">
        <div className="repo-cfg-card-head">
          <b>{IDENTITY_TEXT.title}</b>
          <p>{IDENTITY_TEXT.description}</p>
        </div>
        <div className="repo-cfg-pair">
          <Field label={IDENTITY_TEXT.workspaceId}>
            <Input placeholder="" value={workspaceId} className="repo-cfg-read-only" />
          </Field>
          <Field label={IDENTITY_TEXT.workspaceName}>
            <Input placeholder="" value={workspaceName} />
          </Field>
        </div>
        <Field label={IDENTITY_TEXT.abbreviation} hint={IDENTITY_TEXT.abbreviationHint}>
          <Input placeholder={initials} className="repo-cfg-abbreviation" />
        </Field>
        <Field label={IDENTITY_TEXT.tileColor}>
          <span className="repo-cfg-swatches">
            <span className="repo-cfg-swatch repo-cfg-default" data-selected="">
              <Slash />
            </span>
            {TILE_PALETTE.map((hex) => (
              <span className="repo-cfg-swatch" style={{ backgroundColor: hex }} key={hex} />
            ))}
          </span>
        </Field>
        <Field label={IDENTITY_TEXT.hexCode}>
          <span className="repo-cfg-row">
            <span className="repo-cfg-hash">#</span>
            <Input placeholder="" className="repo-cfg-hex" />
          </span>
        </Field>
        <Field label={IDENTITY_TEXT.repositoryPath} hint={IDENTITY_TEXT.repositoryPathHint}>
          <span className="repo-cfg-row">
            <Input
              placeholder=""
              value={repositoryPath}
              className="repo-cfg-read-only repo-cfg-grow"
            />
            <Button variant="outline">
              <FolderOpen />
              {IDENTITY_TEXT.changeFolder}
            </Button>
          </span>
        </Field>
      </div>
    </div>
  );
}
