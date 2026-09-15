import { WORKSPACE_ABBREVIATION_MAX_LENGTH } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deriveWorkspaceInitials,
  resolveAutomaticTileColors,
  resolveTileColor,
} from "@/lib/workspace-tile-appearance";
import { WorkspaceTileColorPicker } from "./workspace-tile-color-picker";

type WorkspaceIdentityFieldsProps = {
  /** Keeps the control ids unique when the settings panel and a creation form are both mounted. */
  idPrefix: string;
  workspaceId: string;
  workspaceName: string;
  abbreviation: string | null;
  tileColor: string | null;
  /**
   * Every workspace id that competes for an automatic color, including the one being edited or
   * created. The panel and the rail resolve the same assignment from this set.
   */
  configuredWorkspaceIds: readonly string[];
  isDisabled: boolean;
  onChangeAbbreviation: (nextAbbreviation: string) => void;
  onChangeTileColor: (nextTileColor: string | null) => void;
};

/**
 * The abbreviation field and the tile color control that the workspace rail reads. Shared by the
 * workspace settings panel and the repository creation form so both offer the same choices.
 */
export function WorkspaceIdentityFields({
  idPrefix,
  workspaceId,
  workspaceName,
  abbreviation,
  tileColor,
  configuredWorkspaceIds,
  isDisabled,
  onChangeAbbreviation,
  onChangeTileColor,
}: WorkspaceIdentityFieldsProps): ReactElement {
  const automaticAbbreviation = deriveWorkspaceInitials(workspaceName);
  const automaticTileColor = resolveTileColor({
    workspaceId,
    pickedColor: null,
    automaticColors: resolveAutomaticTileColors(configuredWorkspaceIds),
  });
  const abbreviationFieldId = `${idPrefix}-abbreviation`;

  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <Label htmlFor={abbreviationFieldId}>Abbreviation</Label>
        <Input
          id={abbreviationFieldId}
          className="max-w-24"
          value={abbreviation ?? ""}
          placeholder={automaticAbbreviation}
          maxLength={WORKSPACE_ABBREVIATION_MAX_LENGTH}
          disabled={isDisabled}
          onChange={(event) => {
            onChangeAbbreviation(event.currentTarget.value);
          }}
        />
        <p className="text-xs text-muted-foreground">
          Up to {WORKSPACE_ABBREVIATION_MAX_LENGTH} characters shown on the workspace rail tile.
          Leave this blank to use the letters from the workspace name.
        </p>
      </div>

      <WorkspaceTileColorPicker
        idPrefix={idPrefix}
        pickedColor={tileColor}
        automaticColor={automaticTileColor}
        effectiveColor={tileColor ?? automaticTileColor}
        isDisabled={isDisabled}
        onChangeTileColor={onChangeTileColor}
      />
    </div>
  );
}
