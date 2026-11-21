import type { TaskCreateWorkspacePicker as Picker } from "@openducktor/frontend-core/tasks/create/use-task-create-workspace";
import type { ReactElement } from "react";
import { WorkspaceTile } from "@/components/layout/workspace-tile";
import { Button } from "@/components/ui/button";
import { WorkspacePicker } from "@/components/features/workspace-picker/workspace-picker";

/**
 * The workspace of New task, on the title line: "Create task in [workspace]". One open workspace
 * shows as text.
 */
export function TaskCreateWorkspacePicker({
  picker,
  hintId,
}: {
  picker: Picker;
  /** The ID of the blocked hint under the title. */
  hintId: string;
}): ReactElement {
  const { selected } = picker;
  // A closed workspace has no record, so the picker shows its name as the placeholder.
  const name = selected?.workspaceName ?? picker.target?.workspaceName ?? "a workspace";
  return (
    <div className="flex min-w-0 items-center gap-1 text-lg font-semibold leading-6">
      <span className="text-muted-foreground">in</span>
      {picker.choices.length < 2 ? (
        <span className="flex min-w-0 items-center gap-2 px-1.5">
          {selected ? <WorkspaceTile workspace={selected} size="xs" /> : null}
          <span className="truncate">{name}</span>
        </span>
      ) : (
        <WorkspacePicker
          workspaces={picker.choices}
          value={selected?.workspaceId ?? null}
          onValueChange={picker.select}
          label="Workspace"
          placeholder={name}
          variant="inline"
          disabled={!picker.canChange}
          {...(picker.blockedReason ? { "aria-describedby": hintId } : {})}
        />
      )}
    </div>
  );
}

/** Why the workspace cannot change, with the action that frees it. */
export function TaskCreateWorkspaceHint({
  picker,
  hintId,
}: {
  picker: Picker;
  hintId: string;
}): ReactElement | null {
  if (!picker.blockedReason) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
      <span id={hintId}>{picker.blockedReason}</span>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        disabled={picker.isLocked}
        onClick={picker.removeImages}
      >
        Remove images
      </Button>
    </div>
  );
}
