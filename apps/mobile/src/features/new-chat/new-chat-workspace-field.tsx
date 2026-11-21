import type { WorkspaceRecord } from "@openducktor/contracts";
import { useRouter } from "expo-router";
import type { ReactElement } from "react";
import { useMobileWorkspaces } from "@/composition/workspace-selection";
import { WorkspaceSelectField } from "@/features/workspaces/workspace-select-field";

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
  return (
    <WorkspaceSelectField
      workspace={workspace}
      workspaces={workspaces}
      canChange={!disabled && workspaces.length > 1}
      onSelect={(workspaceId) => router.setParams({ workspaceId })}
    />
  );
}
