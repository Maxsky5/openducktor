import type { WorkflowLibraryInputs as Inputs } from "@openducktor/contracts";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { applyWorkflowLibraryChange } from "@openducktor/frontend-core/queries/workflow-library-changes";
import { useMutation, useQueryClient } from "@tanstack/react-query";

type HostClient = ReturnType<typeof useHostClient>;

/**
 * A library command as a mutation. A commit applies the library change to the reads before the
 * mutation settles, so this client does not wait for the library event.
 */
const libraryCommand =
  <Input, Result>(command: (client: HostClient, input: Input) => Promise<Result>) =>
  () => {
    const client = useHostClient();
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (input: Input) => command(client, input),
      onSuccess: () => applyWorkflowLibraryChange(queryClient),
    });
  };

export const useCreateWorkflow = libraryCommand((client, input: Inputs["workflow_create"]) =>
  client.workflowCreate(input),
);
export const useDiscardDraft = libraryCommand((client, input: Inputs["workflow_draft_discard"]) =>
  client.workflowDraftDiscard(input),
);
export const usePublishWorkflow = libraryCommand((client, input: Inputs["workflow_publish"]) =>
  client.workflowPublish(input),
);
export const useMoveTasks = libraryCommand((client, input: Inputs["workflow_tasks_move"]) =>
  client.workflowTasksMove(input),
);
export const useDeleteWorkflow = libraryCommand((client, input: Inputs["workflow_delete"]) =>
  client.workflowDelete(input),
);
export const useImportWorkflow = libraryCommand((client, input: Inputs["workflow_import_commit"]) =>
  client.workflowImportCommit(input),
);
export const useSaveRole = libraryCommand((client, input: Inputs["workflow_role_save"]) =>
  client.workflowRoleSave(input),
);
export const useDeleteRole = libraryCommand((client, input: Inputs["workflow_role_delete"]) =>
  client.workflowRoleDelete(input),
);
export const useSetAvailability = libraryCommand(
  (client, input: Inputs["workflow_availability_set"]) => client.workflowAvailabilitySet(input),
);
export const useSetDefaultWorkflow = libraryCommand(
  (client, input: Inputs["workflow_default_set"]) => client.workflowDefaultSet(input),
);

/** Reads the import plan of a workflow file. It changes nothing. */
export const usePreviewImport = () => {
  const client = useHostClient();
  return useMutation({
    mutationFn: (input: Inputs["workflow_import_preview"]) => client.workflowImportPreview(input),
  });
};

/** Whether a command of a dialog runs, and the message of the first failure. */
export type CommandStatus = { readonly pending: boolean; readonly error: string | null };

/**
 * The state of the commands of one dialog. A dialog resets a command before it runs it again, so
 * the message is the current one.
 */
export const commandStatus = (
  ...commands: readonly { readonly isPending: boolean; readonly error: unknown }[]
): CommandStatus => {
  const failed = commands.find(({ error }) => error !== null);
  return {
    pending: commands.some(({ isPending }) => isPending),
    error: failed ? errorMessage(failed.error) : null,
  };
};
