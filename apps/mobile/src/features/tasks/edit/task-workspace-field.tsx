import type { TaskCreateWorkspacePicker } from "@openducktor/frontend-core/tasks/create/use-task-create-workspace";
import type { ReactElement } from "react";
import { WorkspaceSelectField } from "@/features/workspaces/workspace-select-field";
import { Button } from "@/ui/button";

/**
 * The workspace of a new task. It starts at the current workspace. The issue types come from the
 * workflow of the workspace, so a change returns the form to the type step.
 */
export function TaskWorkspaceField({
  picker,
}: {
  picker: TaskCreateWorkspacePicker;
}): ReactElement {
  return (
    <WorkspaceSelectField
      workspace={picker.selected}
      workspaces={picker.choices}
      canChange={picker.canChange}
      hint={picker.blockedReason}
      onSelect={picker.select}
    >
      {picker.blockedReason ? (
        <Button
          label="Remove images"
          variant="outline"
          size="sm"
          disabled={picker.isLocked}
          accessibilityHint="Removes the images from the description, so you can pick another workspace."
          onPress={picker.removeImages}
        />
      ) : null}
    </WorkspaceSelectField>
  );
}
