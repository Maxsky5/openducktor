import type { WorkflowLibraryRole } from "@openducktor/contracts";
import { Trash2 } from "lucide-react";
import type { ReactElement } from "react";
import { ConfirmDialog, ConfirmSubject } from "@/components/features/confirm/confirm-dialog";
import { commandStatus, useDeleteRole } from "../use-workflow-library-commands";

/** Confirms the delete of a custom role from every repository. */
export function DeleteRoleDialog({
  entry,
  onClose,
}: {
  /** The role to delete. Null closes the dialog. */
  entry: WorkflowLibraryRole | null;
  onClose: () => void;
}): ReactElement {
  const deleteRole = useDeleteRole();
  const { pending, error } = commandStatus(deleteRole);
  const close = () => {
    deleteRole.reset();
    onClose();
  };
  return (
    <ConfirmDialog
      open={entry !== null}
      onOpenChange={(open) => !open && close()}
      title="Delete role"
      description="Delete this role from every repository."
      icon={Trash2}
      subject={entry ? <ConfirmSubject name={entry.role.label} id={entry.role.id} /> : null}
      impact={{
        changes: ["Delete the role", "Delete its Settings overrides and model defaults"],
        warning: "This cannot be undone.",
      }}
      confirmLabel="Delete role"
      variant="destructive"
      pending={pending}
      error={error}
      onConfirm={() => entry && deleteRole.mutate({ roleId: entry.role.id }, { onSuccess: close })}
    />
  );
}
