import type { WorkspaceRecord } from "@openducktor/contracts";
import { useRouter } from "expo-router";
import type { ReactElement } from "react";
import { useMobileWorkspaces } from "@/composition/workspace-selection";
import { WorkspaceTile } from "@/features/workspaces/workspace-tile";
import { ActionMenu } from "@/ui/action-menu";
import { FormField, SelectTrigger } from "@/ui/form-rows";
import { haptics } from "@/ui/haptics";

/**
 * The workspace of the new chat, at the top of the form. The sheet opens on the workspace that
 * the app shows, which is the workspace of the last session that the user opened. So the user can
 * choose another open workspace here. Another workspace starts a new form, because the default
 * model, the roles, and the branches belong to the workspace.
 */
export function NewChatWorkspaceField({
  workspace,
  disabled,
}: {
  workspace: WorkspaceRecord;
  disabled: boolean;
}): ReactElement {
  const router = useRouter();
  const { workspaces } = useMobileWorkspaces();
  const canChange = !disabled && workspaces.length > 1;
  const trigger = (
    <SelectTrigger
      value={workspace.workspaceName}
      detail={workspace.repoPath}
      detailIsPath
      leading={<WorkspaceTile workspace={workspace} size="sm" />}
      placeholder="Select a workspace"
      disabled={!canChange}
      accessibilityLabel="Workspace"
      accessibilityHint={canChange ? "Shows the open workspaces." : undefined}
    />
  );
  return (
    <FormField label="Workspace">
      {canChange ? (
        <ActionMenu
          title="Workspace"
          fill
          items={workspaces.map((entry) => ({
            id: entry.workspaceId,
            title: entry.workspaceName,
            detail: entry.repoPath,
            detailIsPath: true,
            checked: entry.workspaceId === workspace.workspaceId,
          }))}
          onSelect={(workspaceId) => {
            if (workspaceId === workspace.workspaceId) return;
            haptics.selection();
            router.setParams({ workspaceId });
          }}
        >
          {trigger}
        </ActionMenu>
      ) : (
        trigger
      )}
    </FormField>
  );
}
