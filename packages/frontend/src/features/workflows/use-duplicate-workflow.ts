import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useCreateWorkflow } from "./use-workflow-library-commands";
import { workflowPath } from "./workflow-routes";

/** Duplicates a workflow as a custom draft-only workflow and opens the copy. */
export const useDuplicateWorkflow = () => {
  const navigate = useNavigate();
  const create = useCreateWorkflow();
  const duplicate = (workflowId: string) =>
    create.mutate(
      { from: workflowId },
      {
        onSuccess: (created) => navigate(workflowPath(created.workflowId)),
        onError: (cause) =>
          toast.error("The workflow could not be duplicated", {
            description: errorMessage(cause),
          }),
      },
    );
  const duplicatingId =
    create.isPending && create.variables && "from" in create.variables
      ? create.variables.from
      : null;
  return { duplicate, duplicatingId };
};
