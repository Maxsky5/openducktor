import type { WorkspaceRecord } from "@openducktor/contracts";
import type { PropsWithChildren, ReactElement } from "react";
import { WorkspaceTile } from "@/features/workspaces/workspace-tile";
import { ActionMenu } from "@/ui/action-menu";
import { FormField, SelectTrigger } from "@/ui/form-rows";
import { haptics } from "@/ui/haptics";

/**
 * The workspace of a form, with a menu of the open workspaces. `children` show under the control.
 * The menu stays mounted while the trigger is disabled, so the view tree keeps its shape when a
 * save disables the field.
 */
export function WorkspaceSelectField({
  workspace,
  workspaces,
  canChange,
  hint,
  onSelect,
  children,
}: PropsWithChildren<{
  workspace: WorkspaceRecord | null;
  workspaces: readonly WorkspaceRecord[];
  canChange: boolean;
  hint?: string | null | undefined;
  onSelect: (workspaceId: string) => void;
}>): ReactElement {
  return (
    <FormField label="Workspace" hint={hint}>
      <ActionMenu
        title="Workspace"
        fill
        items={workspaces.map((entry) => ({
          id: entry.workspaceId,
          title: entry.workspaceName,
          detail: entry.repoPath,
          detailIsPath: true,
          checked: entry.workspaceId === workspace?.workspaceId,
        }))}
        onSelect={(workspaceId) => {
          if (!canChange || workspaceId === workspace?.workspaceId) return;
          haptics.selection();
          onSelect(workspaceId);
        }}
      >
        <SelectTrigger
          value={workspace?.workspaceName ?? null}
          detail={workspace?.repoPath}
          detailIsPath
          leading={workspace ? <WorkspaceTile workspace={workspace} size="sm" /> : undefined}
          placeholder="Select a workspace"
          disabled={!canChange}
          accessibilityLabel="Workspace"
          accessibilityHint={canChange ? "Shows the open workspaces." : undefined}
        />
      </ActionMenu>
      {children}
    </FormField>
  );
}
